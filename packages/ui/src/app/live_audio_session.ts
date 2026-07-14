import type { LGraph } from 'litegraph.js';
import { mediaSourceFromFile, isLiveGraphNodeId, nodeRegistry } from '@media-workflow/nodes';
import {
  audioBufferToPcmClip,
  connectAudioNodes,
  createLiveAvRecorder,
  createLiveCameraPump,
  createPcmRingAudioBridge,
  decodeMediaSourceToAudioBuffer,
  disconnectAudioNodes,
  getAudioContext,
  isBrowserCaptureAvailable,
  openCaptureStreams,
  resumeAudioContext,
  stopCaptureStreams,
  type LiveAvRecorder,
  type LiveCameraPump,
} from '@media-workflow/codec';
import type {
  DecodedVideoClip,
  DecodedVideoFrame,
  EncodedPacket,
  EncodedTrack,
  MediaFile,
  MediaSource,
  PcmAudioClip,
  RingBufferConfig,
} from '@media-workflow/core';
import {
  createYuvCanvasRenderer,
  type YuvCanvasRenderer,
} from '@media-workflow/codec';
import { pulseControlOutputLinks, pulseFlowingNodeGraph } from './link_flow.js';

interface LGraphNodeLike {
  id: number | string;
  type: string;
  properties?: Record<string, unknown>;
  inputs?: Array<{ name: string; type?: string; link?: number | null }>;
  outputs?: Array<{ name: string; type?: string; links?: number[] | null }>;
  size?: [number, number];
  spectrumBins?: Uint8Array | null;
  spectrumMeta?: { sampleRate: number; fftSize: number; mark: number };
  setDirtyCanvas?: (fg: boolean, bg: boolean) => void;
}

interface LLinkLike {
  id: number;
  origin_id: number;
  origin_slot: number;
  target_id: number;
  target_slot: number;
}

type LGraphInternal = {
  _nodes: LGraphNodeLike[];
  links: Record<string, LLinkLike>;
  getNodeById: (id: number) => LGraphNodeLike | null;
};

export interface LiveAudioSessionOptions {
  graph: LGraph;
  getFileForNode: (nodeId: string) => File | null | undefined;
  /** Optional: PCM produced by a prior batch run, keyed by canvas node id. */
  getPcmForNode?: (nodeId: string) => PcmAudioClip | null | undefined;
  /** Optional: encoded packets from a prior batch run. */
  getPacketsForNode?: (nodeId: string) => EncodedPacket[] | null | undefined;
  /** Optional: decoded video from a prior batch run (ring sidecar + preview). */
  getDecodedVideoForNode?: (nodeId: string) => DecodedVideoClip | null | undefined;
  /** Optional: EncodedTrack for Live stream-decode (preferred over full decoded sidecar). */
  getEncodedTrackForNode?: (nodeId: string) => EncodedTrack | null | undefined;
  onStatus?: (message: string, state?: 'idle' | 'running' | 'success' | 'error') => void;
  onFrame?: () => void;
  /** Fired when Signal Stop finalizes a Live MP4 mux session. */
  onMediaFile?: (canvasNodeId: string, file: MediaFile) => void;
}

interface NativeRecord {
  canvasNodeId: string;
  defId: string;
  /** Primary node used for webaudio graph connections (this node's output). */
  audioNode: AudioNode;
  /** Optional inbound AudioNode (e.g. ring bridge input for continuous). */
  audioInput?: AudioNode;
  gain?: GainNode;
  bufferSource?: AudioBufferSourceNode;
  analyser?: AnalyserNode;
  biquad?: BiquadFilterNode;
  freqBins?: Uint8Array;
  /** Tear down MediaStream / ring bridge. */
  streamPumpStop?: () => void;
  ringBridge?: import('@media-workflow/codec').PcmRingAudioBridge;
  /** Live camera frame pump (Device Capture with enableVideo). */
  cameraPump?: LiveCameraPump;
  /** Device capture mic source (for record tap fallback). */
  mediaStreamSource?: MediaStreamAudioSourceNode;
  scriptProcessor?: ScriptProcessorNode;
  audioTapMute?: GainNode;
  audioTapFrom?: AudioNode;
  /** Shared sidechain listeners (multi-muxer Record fans out from one tap). */
  audioTapListeners?: Array<(
    interleaved: Float32Array,
    sampleRate: number,
    channels: number,
    ptsUs: number,
  ) => void>;
  captureWidth?: number;
  captureHeight?: number;
  captureFrameRate?: number;
}

interface ActiveRecordSession {
  signalNodeId: string;
  muxerNodeId: string;
  sourceNodeId: string;
  /** Native that owns the ScriptProcessor sidechain (detach target). */
  audioTapHostId: string;
  audioListener: (
    interleaved: Float32Array,
    sampleRate: number,
    channels: number,
    ptsUs: number,
  ) => void;
  recorder: LiveAvRecorder;
  lastVideoPtsUs: number;
  startedAtMs: number;
}

interface PreviewHostNode extends LGraphNodeLike {
  displayCanvas?: HTMLCanvasElement;
  displayPreview?: string[];
  yuvRenderer?: YuvCanvasRenderer;
  continuous?: boolean;
}

export interface LiveAudioSession {
  readonly active: boolean;
  start(): Promise<void>;
  stop(): void;
  updateParam(canvasNodeId: string, name: string, value: unknown): void;
  /** Emit a generic pulse from a Trigger button (gate logic into wired pins). */
  emitPulse(canvasNodeId: string): Promise<void>;
}

export function createLiveAudioSession(options: LiveAudioSessionOptions): LiveAudioSession {
  let active = false;
  let rafId = 0;
  const natives = new Map<string, NativeRecord>();
  let startedSources: AudioBufferSourceNode[] = [];
  /** Active Live record sessions keyed by muxer canvas node id. */
  const recordSessions = new Map<string, ActiveRecordSession>();

  async function startMuxerRecord(
    graph: LGraphInternal,
    muxerNodeId: string,
    triggerNodeId: string,
  ): Promise<void> {
    if (recordSessions.has(muxerNodeId)) {
      throw new Error(`Muxer ${muxerNodeId}: already recording`);
    }
    const muxer = graph.getNodeById(Number(muxerNodeId));
    if (!muxer || muxer.type.replace(/^media\//, '') !== 'mp4_muxer') {
      throw new Error('recordStart target must be MP4 Muxer');
    }

    const sourceNodeId = resolveMuxCaptureSourceId(graph, muxer);
    const source = natives.get(sourceNodeId);
    if (!source?.cameraPump) {
      throw new Error('videoStream must resolve to Device Capture with camera');
    }

    const audioTap = resolveMuxAudioTap(graph, muxer, natives, sourceNodeId);
    if (!audioTap) {
      throw new Error('wire webaudio → Muxer.audioIn or enable mic');
    }

    const context = getAudioContext();
    const props = muxer.properties ?? {};
    const recorder = createLiveAvRecorder({
      width: source.captureWidth ?? 640,
      height: source.captureHeight ?? 480,
      sampleRate: context.sampleRate,
      channels: 1,
      framerate: source.captureFrameRate ?? 30,
      videoBitrate: Number(props.videoBitrate) || 2_000_000,
      audioBitrate: Number(props.audioBitrate) || 128_000,
      fileName: String(props.fileName || `live-capture-${muxerNodeId}.mp4`),
    });

    const audioListener = (
      interleaved: Float32Array,
      sampleRate: number,
      channels: number,
      ptsUs: number,
    ) => {
      recorder.pushPcmInterleaved(interleaved, sampleRate, channels, ptsUs);
    };
    attachSharedAudioTap(audioTap.host, context, audioTap.tapFrom, audioListener);

    recordSessions.set(muxerNodeId, {
      signalNodeId: triggerNodeId,
      muxerNodeId,
      sourceNodeId,
      audioTapHostId: audioTap.host.canvasNodeId,
      audioListener,
      recorder,
      lastVideoPtsUs: -1,
      startedAtMs: performance.now(),
    });
  }

  async function stopMuxerRecord(
    muxerNodeId: string,
    reason: 'stop' | 'abort',
  ): Promise<void> {
    const session = recordSessions.get(muxerNodeId);
    if (!session) {
      if (reason === 'stop') {
        throw new Error(`Muxer ${muxerNodeId}: not recording`);
      }
      return;
    }
    recordSessions.delete(muxerNodeId);
    removeSharedAudioTapListener(
      natives.get(session.audioTapHostId),
      session.audioListener,
    );

    if (reason === 'abort') {
      session.recorder.abort();
      return;
    }

    const file = await session.recorder.stop();
    options.onMediaFile?.(session.muxerNodeId, file);
    const seconds = (file.metadata.durationUs as number | undefined) ?? 0;
    options.onStatus?.(
      `Recorded ${file.fileName} · ${(Number(seconds) / 1_000_000).toFixed(1)}s · ${file.data.byteLength} bytes`,
      'success',
    );
  }

  return {
    get active() {
      return active;
    },

    async start() {
      if (active) return;

      const graph = asGraph(options.graph);
      const realtimeNodes = graph._nodes.filter(node => {
        const defId = node.type.replace(/^media\//, '');
        return isLiveNativeForNode(defId, node);
      });

      if (realtimeNodes.length === 0) {
        throw new Error('Live Play: canvas has no realtime audio nodes');
      }

      const context = await resumeAudioContext(getAudioContext());
      natives.clear();
      startedSources = [];

      for (const node of realtimeNodes) {
        const canvasNodeId = String(node.id);
        const defId = node.type.replace(/^media\//, '');
        const params = { ...(node.properties ?? {}) };
        const record = await buildNativeNode({
          context,
          canvasNodeId,
          defId,
          params,
          node,
          graph,
          getFileForNode: options.getFileForNode,
          getPcmForNode: options.getPcmForNode,
          getPacketsForNode: options.getPacketsForNode,
          getDecodedVideoForNode: options.getDecodedVideoForNode,
          getEncodedTrackForNode: options.getEncodedTrackForNode,
        });
        natives.set(canvasNodeId, record);
      }

      wireConnections(graph, natives);

      for (const record of natives.values()) {
        if (!isLiveBufferSourceDef(record.defId) || !record.bufferSource) continue;
        const props = graph.getNodeById(Number(record.canvasNodeId))?.properties ?? {};
        record.bufferSource.loop = props.loop !== false;
        record.bufferSource.start(0);
        startedSources.push(record.bufferSource);
        record.bufferSource = undefined;
      }

      active = true;
      const videoTrackSummaries = [...natives.values()]
        .filter(record => record.ringBridge?.streamingDecoder)
        .map(record => {
          const packets = record.ringBridge!.streamingDecoder!.packetCount();
          const lastPts = record.ringBridge!.streamingDecoder!.lastPtsUs();
          const firstPts = record.ringBridge!.streamingDecoder!.firstPtsUs();
          const seconds = Math.max(0, (lastPts - firstPts) / 1_000_000);
          return `${packets}pkt/${seconds.toFixed(1)}s`;
        });
      options.onStatus?.(
        videoTrackSummaries.length > 0
          ? `Live playing · stream-decode ${videoTrackSummaries.join(', ')}`
          : `Live playing · ${realtimeNodes.length} realtime node(s)`,
        'running',
      );
      startSpectrumLoop();
    },

    async emitPulse(canvasNodeId) {
      if (!active) {
        throw new Error('Trigger: start Live Play first');
      }
      const graph = asGraph(options.graph);
      const routes = findPulseRoutes(graph, canvasNodeId);
      if (routes.length === 0) {
        throw new Error('Trigger: connect Pulse → Muxer recordStart and/or recordStop');
      }

      pulseControlOutputLinks(graph, canvasNodeId);

      let started = 0;
      let stopped = 0;
      const errors: string[] = [];

      for (const route of routes) {
        try {
          if (route.pin === 'recordStart') {
            await startMuxerRecord(graph, route.muxerNodeId, canvasNodeId);
            started += 1;
          } else if (route.pin === 'recordStop') {
            await stopMuxerRecord(route.muxerNodeId, 'stop');
            stopped += 1;
          }
        } catch (error) {
          errors.push(String(error));
        }
      }

      if (started === 0 && stopped === 0) {
        throw new Error(errors.join('; ') || 'Trigger: no action taken');
      }

      const parts: string[] = [];
      if (started > 0) parts.push(`Recording… · ${started} muxer(s)`);
      if (stopped > 0) parts.push(`Stopped ${stopped}`);
      if (errors.length > 0) parts.push(`${errors.length} error(s)`);
      options.onStatus?.(
        parts.join(' · '),
        errors.length && started === 0 && stopped === 0 ? 'error' : 'running',
      );
    },

    stop() {
      if (!active && natives.size === 0) return;

      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }

      for (const session of [...recordSessions.values()]) {
        session.recorder.abort();
        removeSharedAudioTapListener(
          natives.get(session.audioTapHostId),
          session.audioListener,
        );
      }
      recordSessions.clear();

      for (const source of startedSources) {
        try {
          source.stop();
        } catch {
          /* already stopped */
        }
        try {
          source.disconnect();
        } catch {
          /* ignore */
        }
      }
      startedSources = [];

      for (const record of natives.values()) {
        if (record.defId === 'audio_destination') continue;
        try {
          record.streamPumpStop?.();
        } catch {
          /* ignore */
        }
        try {
          disconnectAudioNodes(record.audioNode);
        } catch {
          /* ignore */
        }
        if (record.bufferSource) {
          try {
            record.bufferSource.stop();
          } catch {
            /* ignore */
          }
        }
      }
      clearLiveVideoPreviews(asGraph(options.graph));
      natives.clear();
      active = false;
      options.onStatus?.('Live stopped', 'idle');
    },

    updateParam(canvasNodeId, name, value) {
      if (!active) return;
      const record = natives.get(canvasNodeId);
      if (!record) return;

      const numeric = Number(value);
      if (record.defId === 'ring_buffer_source' || record.defId === 'device_capture') {
        if (name === 'gain' && Number.isFinite(numeric)) {
          if (record.ringBridge) record.ringBridge.setGain(numeric);
          else if (record.gain) record.gain.gain.value = numeric;
        }
        if ((name === 'rate' || name === 'playbackRate') && Number.isFinite(numeric)) {
          if (record.ringBridge) {
            record.ringBridge.setRate(Math.max(0.05, numeric));
          } else {
            for (const source of startedSources) {
              if ((source as AudioBufferSourceNode & { graphNodeId?: string }).graphNodeId
                === canvasNodeId) {
                source.playbackRate.value = Math.max(0.05, numeric);
              }
            }
          }
        }
      }

      if (record.defId === 'audio_gain' && name === 'gain' && record.gain
        && Number.isFinite(numeric)) {
        record.gain.gain.value = numeric;
      }

      if (record.defId === 'audio_biquadfilter' && record.biquad) {
        if (name === 'frequency' && Number.isFinite(numeric)) {
          record.biquad.frequency.value = numeric;
        } else if (name === 'Q' && Number.isFinite(numeric)) {
          record.biquad.Q.value = numeric;
        } else if (name === 'detune' && Number.isFinite(numeric)) {
          record.biquad.detune.value = numeric;
        } else if (name === 'type') {
          record.biquad.type = String(value) as BiquadFilterType;
        }
      }

      if (record.defId === 'audio_analyser' && record.analyser) {
        if (name === 'fftSize' && Number.isFinite(numeric)) {
          record.analyser.fftSize = numeric;
          record.freqBins = new Uint8Array(record.analyser.frequencyBinCount);
        } else if (name === 'minDecibels' && Number.isFinite(numeric)) {
          record.analyser.minDecibels = numeric;
        } else if (name === 'maxDecibels' && Number.isFinite(numeric)) {
          record.analyser.maxDecibels = numeric;
        } else if (name === 'smoothingTimeConstant' && Number.isFinite(numeric)) {
          record.analyser.smoothingTimeConstant = numeric;
        }
      }

      if (record.defId === 'audio_visualization' && name === 'mark') {
        const node = asGraph(options.graph).getNodeById(Number(canvasNodeId));
        if (node?.spectrumMeta) {
          node.spectrumMeta.mark = Number.isFinite(numeric) ? numeric : -1;
        }
      }
    },
  };

  function startSpectrumLoop() {
    let lastStatusAt = 0;
    let lastPtsByRing = new Map<string, number>();
    let lastPtsChangeAt = new Map<string, number>();

    const tick = () => {
      if (!active) return;
      const graph = asGraph(options.graph);
      const context = getAudioContext();
      const now = performance.now();

      for (const record of natives.values()) {
        if (!record.analyser || !record.freqBins) continue;
        const bins = record.freqBins;
        record.analyser.getByteFrequencyData(bins as never);

        const analyserNode = graph.getNodeById(Number(record.canvasNodeId));
        const vizTargets = findSpectrumTargets(graph, record.canvasNodeId);
        for (const vizId of vizTargets) {
          const viz = graph.getNodeById(Number(vizId));
          if (!viz) continue;
          viz.spectrumBins = Uint8Array.from(bins);
          const mark = Number(viz.properties?.mark ?? -1);
          viz.spectrumMeta = {
            sampleRate: context.sampleRate,
            fftSize: record.analyser.fftSize,
            mark: Number.isFinite(mark) ? mark : -1,
          };
          viz.setDirtyCanvas?.(true, false);
        }
        void analyserNode;
      }

      // Ring clocks → video_preview (stream-decode or sidecar)
      const flowSeeds = new Set<string>();

      for (const record of natives.values()) {
        if (!record.ringBridge) continue;
        const bridge = record.ringBridge;
        const ringId = record.canvasNodeId;

        if (bridge.streamingDecoder) {
          const dueFrames = bridge.pullFrames();
          const decodeError = bridge.streamingDecoder.lastError();
          if (decodeError && now - lastStatusAt > 1_000) {
            lastStatusAt = now;
            options.onStatus?.(
              `Live decode error · ${decodeError.message}`,
              'error',
            );
          }

          if (dueFrames.length === 0) continue;
          const frame = dueFrames[dueFrames.length - 1]!;
          const clockUs = bridge.presentationClockUs();
          const endPts = bridge.streamingDecoder.lastPtsUs();
          const prevPts = lastPtsByRing.get(ringId);
          if (prevPts !== frame.ptsUs) {
            lastPtsByRing.set(ringId, frame.ptsUs);
            lastPtsChangeAt.set(ringId, now);
          }
          const ptsMoving = (now - (lastPtsChangeAt.get(ringId) ?? 0)) < 1_200;
          const stillInClip = clockUs <= endPts + 80_000;
          if (stillInClip) {
            flowSeeds.add(ringId);
            for (const previewId of findLiveStreamPreviewTargets(graph, ringId)) {
              flowSeeds.add(previewId);
            }
          }

          const node = graph.getNodeById(Number(ringId));
          if (node) {
            (node as LGraphNodeLike & { ringPacketClock?: { ptsUs: number; count: number } })
              .ringPacketClock = {
                ptsUs: frame.ptsUs,
                count: dueFrames.length,
              };
          }
          void paintLiveVideoPreviews(graph, ringId, frame);

          if (now - lastStatusAt > 1_500) {
            lastStatusAt = now;
            const fed = bridge.stats().frameCache;
            const stalled = stillInClip && !ptsMoving;
            options.onStatus?.(
              `Live · clock ${(clockUs / 1_000_000).toFixed(1)}s`
              + ` · frame ${(frame.ptsUs / 1_000_000).toFixed(1)}s`
              + ` / ${(endPts / 1_000_000).toFixed(1)}s`
              + ` · window ${fed}f`
              + (stalled ? ' · frame stalled' : ''),
              stalled || decodeError ? 'error' : 'running',
            );
          }
          continue;
        }

        const duePackets = bridge.pullPackets();
        const dueFrames = bridge.frameSidecar
          ? bridge.frameSidecar.resolveMany(duePackets)
          : [];
        const node = graph.getNodeById(Number(ringId));
        if (node && duePackets.length > 0) {
          (node as LGraphNodeLike & { ringPacketClock?: { ptsUs: number; count: number } })
            .ringPacketClock = {
              ptsUs: duePackets[duePackets.length - 1]!.ptsUs,
              count: duePackets.length,
            };
          flowSeeds.add(ringId);
          for (const previewId of findLiveStreamPreviewTargets(graph, ringId)) {
            flowSeeds.add(previewId);
          }
        }
        if (dueFrames.length > 0) {
          const frame = dueFrames[dueFrames.length - 1]!;
          void paintLiveVideoPreviews(graph, ringId, frame);
        }
      }

      // Camera → video_preview (via capture.stream and/or downstream ring.stream)
      for (const record of natives.values()) {
        if (!record.cameraPump) continue;
        const frame = record.cameraPump.pullLatest();
        if (!frame) continue;
        flowSeeds.add(record.canvasNodeId);
        void paintLiveVideoPreviews(graph, record.canvasNodeId, frame);
        for (const ringId of findDownstreamLiveStreamNodes(graph, record.canvasNodeId)) {
          flowSeeds.add(ringId);
          void paintLiveVideoPreviews(graph, ringId, frame);
        }
        for (const session of recordSessions.values()) {
          if (session.sourceNodeId !== record.canvasNodeId) continue;
          if (frame.ptsUs === session.lastVideoPtsUs) continue;
          session.lastVideoPtsUs = frame.ptsUs;
          session.recorder.pushVideoFrame(frame);
          flowSeeds.add(session.muxerNodeId);
          // Media wires into muxer (streams / processed audio), not control.
          const muxer = graph.getNodeById(Number(session.muxerNodeId));
          if (muxer) {
            for (const inputName of ['videoStream', 'audioStream', 'audioIn'] as const) {
              const input = muxer.inputs?.find(slot => slot.name === inputName);
              if (input?.link == null) continue;
              const link = graph.links[String(input.link)];
              if (link) flowSeeds.add(String(link.origin_id));
            }
          }
        }
      }

      // Analyser → visualization is also live data flow.
      for (const record of natives.values()) {
        if (!record.analyser) continue;
        flowSeeds.add(record.canvasNodeId);
        for (const vizId of findSpectrumTargets(graph, record.canvasNodeId)) {
          flowSeeds.add(vizId);
        }
      }

      // Continuous A/V media natives only (never trigger_button / mp4_muxer stubs).
      if (active) {
        for (const record of natives.values()) {
          if (CONTINUOUS_MEDIA_LIVE_DEFS.has(record.defId)) {
            flowSeeds.add(record.canvasNodeId);
          }
        }
      }

      if (flowSeeds.size > 0) {
        pulseFlowingNodeGraph(graph, flowSeeds);
      }

      options.onFrame?.();
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }
}

function asGraph(graph: LGraph): LGraphInternal {
  return graph as unknown as LGraphInternal;
}

/** Live natives that continuously carry media (eligible for idle flow seeds). */
const CONTINUOUS_MEDIA_LIVE_DEFS = new Set([
  'device_capture',
  'ring_buffer_source',
  'audio_gain',
  'audio_biquadfilter',
  'audio_analyser',
  'audio_destination',
]);

/** Nodes that own a native AudioNode during Live Play (excludes bake/viz helpers). */
function isLiveNativeForNode(defId: string, node: LGraphNodeLike): boolean {
  if (defId === 'webaudio_to_pcm' || defId === 'audio_visualization') return false;
  if (defId === 'trigger_button') return true;
  if (defId === 'mp4_muxer') return hasLiveMuxSessionPins(node);
  return isLiveGraphNodeId(defId) && defId !== 'mp4_muxer';
}

function hasLiveMuxSessionPins(node: LGraphNodeLike): boolean {
  return Boolean(
    node.inputs?.some(input =>
      (input.name === 'recordStart'
        || input.name === 'recordStop'
        || input.name === 'videoStream'
        || input.name === 'audioStream'
        || input.name === 'audioIn')
      && input.link != null),
  );
}

function isLiveBufferSourceDef(defId: string): boolean {
  return defId === 'ring_buffer_source';
}

function findSpectrumTargets(graph: LGraphInternal, analyserId: string): string[] {
  const analyser = graph.getNodeById(Number(analyserId));
  if (!analyser?.outputs) return [];
  const spectrumSlot = analyser.outputs.findIndex(output => output.name === 'spectrum');
  if (spectrumSlot < 0) return [];
  const links = analyser.outputs[spectrumSlot]?.links ?? [];
  const targets: string[] = [];
  for (const linkId of links) {
    const link = graph.links[String(linkId)];
    if (!link) continue;
    targets.push(String(link.target_id));
  }
  return targets;
}

function wireConnections(
  graph: LGraphInternal,
  natives: Map<string, NativeRecord>,
): void {
  for (const link of Object.values(graph.links ?? {})) {
    if (!link) continue;
    const origin = graph.getNodeById(link.origin_id);
    const target = graph.getNodeById(link.target_id);
    if (!origin || !target) continue;

    const originDef = origin.type.replace(/^media\//, '');
    const targetDef = target.type.replace(/^media\//, '');
    if (!isLiveGraphNodeId(originDef) || !isLiveGraphNodeId(targetDef)) continue;

    const outSlot = origin.outputs?.[link.origin_slot];
    const inSlot = target.inputs?.[link.target_slot];
    if (!outSlot || !inSlot) continue;
    if (outSlot.name !== 'out') continue;
    if (inSlot.name !== 'in' && inSlot.name !== 'audioIn') continue;
    if (inSlot.type && inSlot.type !== 'webaudio') continue;
    if (outSlot.type && outSlot.type !== 'webaudio') continue;

    const from = natives.get(String(origin.id));
    const to = natives.get(String(target.id));
    if (!from || !to) continue;
    connectAudioNodes(from.audioNode, to.audioInput ?? to.audioNode);
  }
}

async function buildNativeNode(args: {
  context: AudioContext;
  canvasNodeId: string;
  defId: string;
  params: Record<string, unknown>;
  node: LGraphNodeLike;
  graph: LGraphInternal;
  getFileForNode: (nodeId: string) => File | null | undefined;
  getPcmForNode?: (nodeId: string) => PcmAudioClip | null | undefined;
  getPacketsForNode?: (nodeId: string) => EncodedPacket[] | null | undefined;
  getDecodedVideoForNode?: (nodeId: string) => DecodedVideoClip | null | undefined;
  getEncodedTrackForNode?: (nodeId: string) => EncodedTrack | null | undefined;
}): Promise<NativeRecord> {
  const { context, canvasNodeId, defId, params, node, graph } = args;

  if (defId === 'ring_buffer_source') {
    const fillMode = resolveRingFillMode(params, node);
    const ringConfig = ringConfigFromParams(params, fillMode);
    const packets = resolveLinkedPackets({
      node,
      graph,
      getPacketsForNode: args.getPacketsForNode,
    });
    const encodedTrack = resolveLinkedEncodedTrack({
      node,
      graph,
      getEncodedTrackForNode: args.getEncodedTrackForNode,
    });
    const frames = encodedTrack
      ? null
      : resolveLinkedDecodedFrames({
        node,
        graph,
        getDecodedVideoForNode: args.getDecodedVideoForNode,
      });

    const hasVideoPayload = Boolean(
      encodedTrack?.packets.length || frames?.length || packets?.length,
    );

    if (fillMode === 'continuous') {
      const bridge = await createPcmRingAudioBridge({
        context,
        config: ringConfig,
        channels: 1,
        packets: packets ?? undefined,
        frames: frames ?? undefined,
        encodedTrack: encodedTrack ?? undefined,
      });
      return {
        canvasNodeId,
        defId,
        audioNode: bridge.output,
        audioInput: bridge.input,
        gain: bridge.gain,
        ringBridge: bridge,
        streamPumpStop: () => bridge.stop(),
      };
    }

    const pcm = await resolveRingBufferAudioClip({
      node,
      graph,
      context,
      getFileForNode: args.getFileForNode,
      getPcmForNode: args.getPcmForNode,
      allowSilentVideoOnly: hasVideoPayload,
    });
    const bridge = await createPcmRingAudioBridge({
      context,
      config: ringConfig,
      clip: pcm,
      channels: pcm.channels,
      sampleRate: pcm.sampleRate,
      packets: packets ?? undefined,
      frames: frames ?? undefined,
      encodedTrack: encodedTrack ?? undefined,
    });
    return {
      canvasNodeId,
      defId,
      audioNode: bridge.output,
      audioInput: bridge.input,
      gain: bridge.gain,
      ringBridge: bridge,
      streamPumpStop: () => bridge.stop(),
    };
  }

  if (defId === 'device_capture') {
    if (!isBrowserCaptureAvailable()) {
      throw new Error('Live Play: Device Capture requires browser MediaDevices API');
    }
    const enableVideo = params.enableVideo !== false;
    const enableMicrophone = params.enableMicrophone !== false;
    const enableSpeaker = Boolean(params.enableSpeaker);
    if (!enableMicrophone && !enableSpeaker && !enableVideo) {
      throw new Error(
        'Live Play: Device Capture needs microphone, speaker, and/or camera enabled',
      );
    }
    const opened = await openCaptureStreams({
      enableVideo,
      enableMicrophone,
      enableSpeaker,
      videoDeviceId: String(params.videoDeviceId ?? '').trim() || undefined,
      audioDeviceId: String(params.audioDeviceId ?? '').trim() || undefined,
      width: Number(params.width) || 640,
      height: Number(params.height) || 480,
      frameRate: Number(params.frameRate) || 30,
    });
    const audioTracks = [
      ...(opened.micStream?.getAudioTracks() ?? []),
      ...(opened.speakerStream?.getAudioTracks() ?? []),
    ];
    const videoTrack = opened.videoStream?.getVideoTracks()[0];
    if (audioTracks.length === 0 && !videoTrack) {
      stopCaptureStreams(opened.streams);
      throw new Error('Live Play: Device Capture got no media tracks');
    }

    const gain = context.createGain();
    gain.gain.value = 1;
    let mediaStreamSource: MediaStreamAudioSourceNode | undefined;
    if (audioTracks.length > 0) {
      const mixed = new MediaStream(audioTracks);
      mediaStreamSource = context.createMediaStreamSource(mixed);
      connectAudioNodes(mediaStreamSource, gain);
    }

    const cameraPump = videoTrack ? createLiveCameraPump(videoTrack) : undefined;
    return {
      canvasNodeId,
      defId,
      audioNode: gain,
      gain,
      cameraPump,
      mediaStreamSource,
      captureWidth: Number(params.width) || 640,
      captureHeight: Number(params.height) || 480,
      captureFrameRate: Number(params.frameRate) || 30,
      streamPumpStop: () => {
        cameraPump?.stop();
        stopCaptureStreams(opened.streams);
      },
    };
  }

  if (defId === 'trigger_button' || defId === 'mp4_muxer') {
    // Control / Live-mux descriptors — stub AudioNode so they participate in Live natives.
    const gain = context.createGain();
    gain.gain.value = 0;
    return { canvasNodeId, defId, audioNode: gain, gain };
  }

  if (defId === 'audio_gain') {
    const gain = context.createGain();
    gain.gain.value = Number(params.gain) || 1;
    return { canvasNodeId, defId, audioNode: gain, gain };
  }

  if (defId === 'audio_biquadfilter') {
    const biquad = context.createBiquadFilter();
    biquad.type = String(params.type ?? 'lowpass') as BiquadFilterType;
    biquad.frequency.value = Number(params.frequency) || 350;
    biquad.Q.value = Number(params.Q) || 1;
    biquad.detune.value = Number(params.detune) || 0;
    return { canvasNodeId, defId, audioNode: biquad, biquad };
  }

  if (defId === 'audio_analyser') {
    const analyser = context.createAnalyser();
    analyser.fftSize = Number(params.fftSize) || 2048;
    analyser.minDecibels = Number(params.minDecibels) || -100;
    analyser.maxDecibels = Number(params.maxDecibels) || -10;
    analyser.smoothingTimeConstant = Number(params.smoothingTimeConstant) || 0.5;
    return {
      canvasNodeId,
      defId,
      audioNode: analyser,
      analyser,
      freqBins: new Uint8Array(analyser.frequencyBinCount),
    };
  }

  if (defId === 'audio_destination') {
    return { canvasNodeId, defId, audioNode: context.destination };
  }

  const known = nodeRegistry.get(defId);
  throw new Error(`Live Play: unsupported realtime node ${known?.displayName ?? defId}`);
}

function resolveLinkedPcm(args: {
  node: LGraphNodeLike;
  graph: LGraphInternal;
  inputName: string;
  getPcmForNode?: (nodeId: string) => PcmAudioClip | null | undefined;
}): PcmAudioClip | null {
  const pcmInput = args.node.inputs?.find(input => input.name === args.inputName);
  if (pcmInput?.link == null) return null;
  const link = args.graph.links[String(pcmInput.link)];
  if (!link) return null;
  return args.getPcmForNode?.(String(link.origin_id)) ?? null;
}

function hasLiveRingInput(node: LGraphNodeLike): boolean {
  return Boolean(
    node.inputs?.some(input =>
      (input.name === 'audioIn' || input.name === 'liveIn') && input.link != null),
  );
}

function resolveRingFillMode(
  params: Record<string, unknown>,
  node: LGraphNodeLike,
): 'static_once' | 'continuous' {
  const explicit = String(params.fillMode ?? '').trim();
  if (explicit === 'static_once' || explicit === 'continuous') return explicit;
  return hasLiveRingInput(node) ? 'continuous' : 'static_once';
}

function ringConfigFromParams(
  params: Record<string, unknown>,
  fillMode: 'static_once' | 'continuous',
): RingBufferConfig {
  const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => {
    const text = String(value ?? '');
    return (allowed as readonly string[]).includes(text) ? (text as T) : fallback;
  };
  return {
    fillMode,
    ioMode: pick(params.ioMode, ['producer_push', 'consumer_pull'] as const, 'producer_push'),
    clockMode: pick(params.clockMode, ['realtime', 'fixed_rate'] as const, 'realtime'),
    rate: Math.max(0.05, Number(params.rate ?? params.playbackRate) || 1),
    targetSampleRate: Math.max(0, Number(params.targetSampleRate) || 0),
    targetFrameRate: Math.max(0, Number(params.targetFrameRate) || 0),
    capacitySeconds: Math.max(0.05, Number(params.capacitySeconds) || 1),
    underrunPolicy: pick(
      params.underrunPolicy,
      ['silence', 'wait', 'loop'] as const,
      'silence',
    ),
    overrunPolicy: pick(
      params.overrunPolicy,
      ['drop_oldest', 'block_producer', 'drop_newest'] as const,
      'drop_oldest',
    ),
    loop: params.loop !== false,
    gain: Number.isFinite(Number(params.gain)) ? Number(params.gain) : 1,
  };
}

function resolveLinkedPackets(args: {
  node: LGraphNodeLike;
  graph: LGraphInternal;
  getPacketsForNode?: (nodeId: string) => EncodedPacket[] | null | undefined;
}): EncodedPacket[] | null {
  for (const inputName of ['packets', 'track'] as const) {
    const input = args.node.inputs?.find(slot => slot.name === inputName);
    if (input?.link == null) continue;
    const link = args.graph.links[String(input.link)];
    if (!link) continue;
    const packets = args.getPacketsForNode?.(String(link.origin_id));
    if (packets?.length) return packets;
  }
  return null;
}

function resolveLinkedEncodedTrack(args: {
  node: LGraphNodeLike;
  graph: LGraphInternal;
  getEncodedTrackForNode?: (nodeId: string) => EncodedTrack | null | undefined;
}): EncodedTrack | null {
  const input = args.node.inputs?.find(slot => slot.name === 'track');
  if (input?.link == null) return null;
  const link = args.graph.links[String(input.link)];
  if (!link) return null;
  const track = args.getEncodedTrackForNode?.(String(link.origin_id));
  return track?.packets.length ? track : null;
}

function resolveLinkedDecodedFrames(args: {
  node: LGraphNodeLike;
  graph: LGraphInternal;
  getDecodedVideoForNode?: (nodeId: string) => DecodedVideoClip | null | undefined;
}): DecodedVideoFrame[] | null {
  for (const inputName of ['video', 'frame'] as const) {
    const input = args.node.inputs?.find(slot => slot.name === inputName);
    if (input?.link == null) continue;
    const link = args.graph.links[String(input.link)];
    if (!link) continue;
    const clip = args.getDecodedVideoForNode?.(String(link.origin_id));
    if (clip?.frames?.length) return clip.frames;
  }
  return null;
}

function findLiveStreamPreviewTargets(graph: LGraphInternal, sourceNodeId: string): string[] {
  const source = graph.getNodeById(Number(sourceNodeId));
  if (!source?.outputs) return [];
  const streamSlot = source.outputs.findIndex(output => output.name === 'stream');
  if (streamSlot < 0) return [];
  const links = source.outputs[streamSlot]?.links ?? [];
  const targets: string[] = [];
  for (const linkId of links) {
    const link = graph.links[String(linkId)];
    if (!link) continue;
    const target = graph.getNodeById(link.target_id);
    const defId = target?.type.replace(/^media\//, '');
    if (defId === 'video_preview') targets.push(String(link.target_id));
  }
  return targets;
}

/** Nodes that consume this node's live_stream output (e.g. Ring Buffer). */
function findDownstreamLiveStreamNodes(
  graph: LGraphInternal,
  sourceNodeId: string,
): string[] {
  const source = graph.getNodeById(Number(sourceNodeId));
  if (!source?.outputs) return [];
  const streamSlot = source.outputs.findIndex(output => output.name === 'stream');
  if (streamSlot < 0) return [];
  const links = source.outputs[streamSlot]?.links ?? [];
  const targets: string[] = [];
  for (const linkId of links) {
    const link = graph.links[String(linkId)];
    if (!link) continue;
    const target = graph.getNodeById(link.target_id);
    const defId = target?.type.replace(/^media\//, '');
    if (defId === 'ring_buffer_source') targets.push(String(link.target_id));
  }
  return targets;
}

async function paintLiveVideoPreviews(
  graph: LGraphInternal,
  ringNodeId: string,
  frame: DecodedVideoFrame,
): Promise<void> {
  for (const previewId of findLiveStreamPreviewTargets(graph, ringNodeId)) {
    const preview = graph.getNodeById(Number(previewId)) as PreviewHostNode | null;
    if (!preview) continue;
    if (preview.properties?.continuous === false) continue;

    if (!preview.displayCanvas) {
      preview.displayCanvas = document.createElement('canvas');
      preview.displayCanvas.width = Math.max(1, frame.displayWidth);
      preview.displayCanvas.height = Math.max(1, frame.displayHeight);
    }

    try {
      if (!preview.yuvRenderer) {
        preview.yuvRenderer = await createYuvCanvasRenderer(preview.displayCanvas);
      }
      preview.yuvRenderer.draw(frame);
      preview.displayPreview = [
        `${frame.displayWidth}×${frame.displayHeight} · ${frame.format}`,
        `pts ${(frame.ptsUs / 1_000_000).toFixed(3)}s · ${preview.yuvRenderer.backend}`,
      ];
      preview.setDirtyCanvas?.(true, false);
    } catch (error) {
      preview.displayPreview = [
        'WebGPU draw failed',
        error instanceof Error ? error.message : String(error),
      ];
    }
  }
}

function clearLiveVideoPreviews(graph: LGraphInternal): void {
  for (const node of graph._nodes) {
    const defId = node.type.replace(/^media\//, '');
    if (defId !== 'video_preview') continue;
    const preview = node as PreviewHostNode;
    preview.yuvRenderer?.destroy();
    preview.yuvRenderer = undefined;
  }
}

function silentVideoClockClip(sampleRate = 48_000, seconds = 0.25): PcmAudioClip {
  const sampleCount = Math.max(1, Math.floor(sampleRate * seconds));
  return {
    clipId: `ring:silent:${sampleRate}:${sampleCount}`,
    sourceTrackId: 'silent',
    ptsUs: 0,
    durationUs: Math.round((sampleCount / sampleRate) * 1_000_000),
    sampleRate,
    channels: 1,
    sampleCount,
    format: 'f32-planar',
    planes: [new Float32Array(sampleCount)],
    backend: {
      id: 'silent-clock',
      version: '0',
      api: 'mock',
      codecFamilies: [],
      inputFormats: [],
      outputFormats: ['f32-planar'],
    },
    diagnostics: [],
  };
}

async function resolveRingBufferAudioClip(args: {
  node: LGraphNodeLike;
  graph: LGraphInternal;
  context: AudioContext;
  getFileForNode: (nodeId: string) => File | null | undefined;
  getPcmForNode?: (nodeId: string) => PcmAudioClip | null | undefined;
  allowSilentVideoOnly?: boolean;
}): Promise<PcmAudioClip> {
  const pcm = resolveLinkedPcm({
    node: args.node,
    graph: args.graph,
    inputName: 'pcm',
    getPcmForNode: args.getPcmForNode,
  });
  if (pcm) return pcm;

  const buffer = await resolveMediaSourceBuffer(args);
  if (buffer) {
    return audioBufferToPcmClip(buffer, {
      clipId: `ring:media_source:${buffer.sampleRate}:${buffer.length}`,
      sourceTrackId: 'media_source',
    });
  }

  if (args.allowSilentVideoOnly) {
    return silentVideoClockClip(args.context.sampleRate);
  }

  throw new Error(
    'Live Play: Ring Buffer Source webaudio needs pcm_audio (先「运行」) '
    + 'or media_source (File Loader)；纯视频可接 decoded_video/packets',
  );
}

async function resolveMediaSourceBuffer(args: {
  node: LGraphNodeLike;
  graph: LGraphInternal;
  context: AudioContext;
  getFileForNode: (nodeId: string) => File | null | undefined;
}): Promise<AudioBuffer | null> {
  const sourceInput = args.node.inputs?.find(input => input.name === 'source');
  if (sourceInput?.link == null) return null;
  const link = args.graph.links[String(sourceInput.link)];
  if (!link) return null;
  const origin = args.graph.getNodeById(link.origin_id);
  const originDef = origin?.type.replace(/^media\//, '') ?? '';
  if (originDef !== 'file_loader') {
    throw new Error('Live Play: media_source must come from File Loader');
  }
  const file = args.getFileForNode(String(link.origin_id));
  if (!file) {
    throw new Error('Live Play: File Loader has no file selected');
  }
  const source = await mediaSourceFromFile(file);
  return decodeMediaSourceToAudioBuffer(source, args.context);
}

function findPulseRoutes(
  graph: LGraphInternal,
  triggerNodeId: string,
): Array<{ muxerNodeId: string; pin: 'recordStart' | 'recordStop' }> {
  const trigger = graph.getNodeById(Number(triggerNodeId));
  if (!trigger?.outputs) return [];
  const slot = trigger.outputs.findIndex(output => output.name === 'out');
  if (slot < 0) return [];
  const routes: Array<{ muxerNodeId: string; pin: 'recordStart' | 'recordStop' }> = [];
  for (const linkId of trigger.outputs[slot]?.links ?? []) {
    const link = graph.links[String(linkId)];
    if (!link) continue;
    const target = graph.getNodeById(link.target_id);
    if (!target || target.type.replace(/^media\//, '') !== 'mp4_muxer') continue;
    const inSlot = target.inputs?.[link.target_slot];
    if (inSlot?.name === 'recordStart' || inSlot?.name === 'recordStop') {
      routes.push({
        muxerNodeId: String(link.target_id),
        pin: inSlot.name,
      });
    }
  }
  return routes;
}

function resolveMuxCaptureSourceId(graph: LGraphInternal, muxer: LGraphNodeLike): string {
  for (const inputName of ['videoStream', 'audioStream'] as const) {
    const input = muxer.inputs?.find(slot => slot.name === inputName);
    if (input?.link == null) continue;
    const link = graph.links[String(input.link)];
    if (!link) continue;
    const origin = graph.getNodeById(link.origin_id);
    if (!origin) continue;
    const defId = origin.type.replace(/^media\//, '');
    if (defId === 'device_capture') return String(origin.id);
    if (defId === 'ring_buffer_source') {
      const upstream = findUpstreamDeviceCapture(graph, String(origin.id));
      if (upstream) return upstream;
    }
  }
  throw new Error('Signal: wire Device Capture.stream into MP4 Muxer videoStream/audioStream');
}

function findUpstreamDeviceCapture(graph: LGraphInternal, ringNodeId: string): string | null {
  const ring = graph.getNodeById(Number(ringNodeId));
  if (!ring?.inputs) return null;
  for (const input of ring.inputs) {
    if (input.link == null) continue;
    if (input.name !== 'liveIn' && input.name !== 'audioIn') continue;
    const link = graph.links[String(input.link)];
    if (!link) continue;
    const origin = graph.getNodeById(link.origin_id);
    if (origin?.type.replace(/^media\//, '') === 'device_capture') {
      return String(origin.id);
    }
  }
  return null;
}

function resolveMuxAudioTap(
  graph: LGraphInternal,
  muxer: LGraphNodeLike,
  natives: Map<string, NativeRecord>,
  captureNodeId: string,
): { host: NativeRecord; tapFrom: AudioNode; processed: boolean } | null {
  const audioIn = muxer.inputs?.find(slot => slot.name === 'audioIn');
  if (audioIn?.link != null) {
    const link = graph.links[String(audioIn.link)];
    const origin = link ? graph.getNodeById(link.origin_id) : null;
    if (origin) {
      const host = natives.get(String(origin.id));
      if (host?.audioNode) {
        return { host, tapFrom: host.audioNode, processed: true };
      }
    }
  }

  const capture = natives.get(captureNodeId);
  if (capture?.audioNode) {
    return { host: capture, tapFrom: capture.audioNode, processed: false };
  }
  return null;
}

function attachSharedAudioTap(
  host: NativeRecord,
  context: AudioContext,
  tapFrom: AudioNode,
  listener: (
    interleaved: Float32Array,
    sampleRate: number,
    channels: number,
    ptsUs: number,
  ) => void,
): void {
  if (!host.audioTapListeners) host.audioTapListeners = [];
  host.audioTapListeners.push(listener);

  if (host.scriptProcessor) {
    host.audioTapFrom = tapFrom;
    return;
  }

  const channels = 1;
  const processor = context.createScriptProcessor(4096, channels, channels);
  const mute = context.createGain();
  mute.gain.value = 0;
  processor.onaudioprocess = event => {
    const input = event.inputBuffer.getChannelData(0);
    const copy = new Float32Array(input.length);
    copy.set(input);
    const ptsUs = Math.round(performance.now() * 1_000);
    for (const cb of host.audioTapListeners ?? []) {
      cb(copy, context.sampleRate, channels, ptsUs);
    }
    event.outputBuffer.getChannelData(0).fill(0);
  };
  tapFrom.connect(processor);
  processor.connect(mute);
  mute.connect(context.destination);
  host.scriptProcessor = processor;
  host.audioTapMute = mute;
  host.audioTapFrom = tapFrom;
}

function removeSharedAudioTapListener(
  host: NativeRecord | undefined,
  listener: (
    interleaved: Float32Array,
    sampleRate: number,
    channels: number,
    ptsUs: number,
  ) => void,
): void {
  if (!host?.audioTapListeners) return;
  host.audioTapListeners = host.audioTapListeners.filter(cb => cb !== listener);
  if (host.audioTapListeners.length === 0) {
    detachAudioTap(host);
  }
}

function detachAudioTap(source: NativeRecord | undefined): void {
  if (!source?.scriptProcessor) {
    source && (source.audioTapListeners = undefined);
    return;
  }
  const processor = source.scriptProcessor;
  const mute = source.audioTapMute;
  const from = source.audioTapFrom;
  try {
    from?.disconnect(processor);
  } catch {
    /* ignore */
  }
  try {
    processor.disconnect();
  } catch {
    /* ignore */
  }
  try {
    mute?.disconnect();
  } catch {
    /* ignore */
  }
  processor.onaudioprocess = null;
  source.scriptProcessor = undefined;
  source.audioTapMute = undefined;
  source.audioTapFrom = undefined;
  source.audioTapListeners = undefined;
}

/** Draw spectrum bars onto a visualization node's canvas overlay context. */
export function drawAudioSpectrumPreview(
  node: {
    size?: [number, number];
    spectrumBins?: Uint8Array | null;
    spectrumMeta?: { sampleRate: number; fftSize: number; mark: number };
  },
  ctx: CanvasRenderingContext2D,
): void {
  const bins = node.spectrumBins;
  if (!bins || bins.length === 0) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, node.size?.[0] ?? 280, 140);
    ctx.fillStyle = '#9aa1b3';
    ctx.font = '12px sans-serif';
    ctx.fillText('Live Play to show spectrum', 12, 24);
    return;
  }

  const width = node.size?.[0] ?? 280;
  const height = 140;
  ctx.fillStyle = '#0c0e14';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#7c5cff';
  ctx.beginPath();
  const delta = bins.length / width;
  ctx.moveTo(0, height);
  for (let x = 0; x < width; x++) {
    const value = bins[(x * delta) | 0] ?? 0;
    ctx.lineTo(x, height - (value / 255) * height);
  }
  ctx.stroke();

  const mark = node.spectrumMeta?.mark ?? -1;
  const sampleRate = node.spectrumMeta?.sampleRate ?? 48_000;
  if (mark >= 0 && node.spectrumMeta) {
    const binfreq = sampleRate / bins.length;
    const x = (2 * (mark / binfreq)) / delta;
    ctx.strokeStyle = '#ff6b6b';
    ctx.beginPath();
    ctx.moveTo(Math.min(width - 1, x), height);
    ctx.lineTo(Math.min(width - 1, x), 0);
    ctx.stroke();
  }
}

export async function fileToMediaSource(file: File): Promise<MediaSource> {
  return mediaSourceFromFile(file);
}
