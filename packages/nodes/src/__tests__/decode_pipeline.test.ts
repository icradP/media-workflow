import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DECODER_CAPABILITIES,
  extractTransferablesFromDecodedOutput,
  findDecoderCapability,
} from '@media-workflow/core/decoder';
import {
  createMemoryCache,
  executeGraph,
  type MediaFile,
  type MediaSource,
  type NodeDefinition,
} from '@media-workflow/core';
import { isMp4OrFmp4Signature, parseMp4Metadata } from '@media-workflow/codec';
import { instantiateWorkflowPreset, type WorkflowPreset } from '../preset.js';
import { fileLoaderNode } from '../source/file_loader.js';
import { nodeRegistry } from '../registry.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const workflowsDir = join(root, 'packages', 'nodes', 'presets');

describe('decode pipeline nodes', () => {
  it('registers selection, task decoder, transform and export nodes', () => {
    const ids = [
      'track_select',
      'media_select',
      'video_decode',
      'audio_decode',
      'frame_extract',
      'video_preview',
      'wav_player',
      'mp4_player',
      'sample_table',
      'wav_encoder',
      'mp4_muxer',
      'raw_yuv_exporter',
      'file_export',
    ];
    for (const id of ids) {
      expect(nodeRegistry.has(id)).toBe(true);
    }
  });

  it('exposes decoder capabilities for supported codecs', () => {
    expect(DECODER_CAPABILITIES.length).toBeGreaterThanOrEqual(3);
    expect(findDecoderCapability('h264', 'avcc')?.id).toBe('webcodecs-h264');
    expect(findDecoderCapability('aac', 'adts')?.id).toBe('webcodecs-aac');
    expect(findDecoderCapability('g711', 'g711_ulaw')?.id).toBe('g711-software');
  });

  it('extracts transferables from decoded outputs', () => {
    const buffer = new ArrayBuffer(16);
    const transferables = extractTransferablesFromDecodedOutput({
      frames: {
        requestId: 'req',
        backend: DECODER_CAPABILITIES[0]!,
        frames: [{
          frameId: 'f1',
          sourceSampleId: 's1',
          ptsUs: 0,
          codedWidth: 2,
          codedHeight: 2,
          displayWidth: 2,
          displayHeight: 2,
          format: 'I420',
          planes: [new Uint8Array(buffer)],
          strides: [2],
          metadata: {},
        }],
        diagnostics: [],
      },
    });
    expect(transferables).toContain(buffer);
  });
});

describe('decode workflow presets', () => {
  it('materializes a stable first-keyframe video selection for FLV', async () => {
    const preset = readPreset('decode-first-keyframe.workflow.json');
    const source = sourceFromFixture('tests/generated-av.flv');
    const results = await runPreset(preset, source);
    const selection = results.get('selection')?.get('selection') as {
      selectionId: string;
      samples: Array<{ isKey: boolean }>;
    } | undefined;
    expect(selection?.selectionId).toMatch(/^selection:/);
    expect(selection?.samples).toHaveLength(1);
    expect(selection?.samples[0]?.isKey).toBe(true);
  });

  it('materializes an exact five-second audio selection for FLV', async () => {
    const preset: WorkflowPreset = {
      version: 1,
      name: 'Audio selection',
      nodes: [
        { id: 'file', type: 'file_loader' },
        { id: 'analyze', type: 'auto_analyze' },
        {
          id: 'selection',
          type: 'media_select',
          params: {
            kind: 'audio',
            trackIndex: 0,
            startTimeSeconds: 0,
            endTimeSeconds: 5,
          },
        },
      ],
      edges: [
        {
          id: 'file-analyze',
          sourceNodeId: 'file',
          sourceOutput: 'source',
          targetNodeId: 'analyze',
          targetInput: 'source',
        },
        {
          id: 'analyze-selection',
          sourceNodeId: 'analyze',
          sourceOutput: 'asset',
          targetNodeId: 'selection',
          targetInput: 'source',
        },
      ],
    };
    const source = sourceFromFixture('tests/generated-av.flv');
    const results = await runPreset(preset, source);
    const selection = results.get('selection')?.get('selection') as {
      rangeStartUs: number;
      rangeEndUs?: number;
      samples: unknown[];
    } | undefined;
    expect(selection?.rangeStartUs).toBe(0);
    expect(selection?.rangeEndUs).toBe(5_000_000);
    expect(selection?.samples.length).toBeGreaterThan(0);
  });

  it('remuxes MP4 from the remux-mp4-selections preset', async () => {
    const preset = readPreset('remux-mp4-selections.workflow.json');
    const source = sourceFromFixture('tests/generated-av.mp4');
    const results = await runPreset(preset, source);

    const videoSelection = results.get('video-select')?.get('selection') as {
      samples: unknown[];
    } | undefined;
    const audioSelection = results.get('audio-select')?.get('selection') as {
      samples: unknown[];
    } | undefined;
    expect(videoSelection?.samples.length).toBeGreaterThan(0);
    expect(audioSelection?.samples.length).toBeGreaterThan(0);

    const file = results.get('mux')?.get('file') as MediaFile | undefined;
    expect(file?.mimeType).toBe('video/mp4');
    expect(file?.extension).toBe('mp4');
    expect(file?.data.byteLength).toBeGreaterThan(1024);
    expect(isMp4OrFmp4Signature(file!.data)).toBe(true);
    expect(Number(file?.metadata.videoSampleCount)).toBeGreaterThan(0);
    expect(Number(file?.metadata.audioSampleCount)).toBeGreaterThan(0);
    expect(file?.metadata.alignMode).toBe('trim_to_video');

    const metadata = parseMp4Metadata(file!.data);
    expect(metadata?.trackCount).toBeGreaterThanOrEqual(2);
    expect(metadata?.durationMs).toBeGreaterThan(0);

    const preview = JSON.parse(String(results.get('play')?.get('preview')));
    expect(preview.fileName).toBe('output.mp4');
    expect(preview.durationMs).toBeGreaterThan(0);
    expect(preview.videoTrackCount).toBeGreaterThan(0);
    expect(preview.audioTrackCount).toBeGreaterThan(0);

    const download = JSON.parse(String(results.get('download')?.get('download')));
    expect(download.fileName).toBe('output.mp4');
    expect(download.byteLength).toBe(file!.data.byteLength);
  });

  it('remuxes MP4 video with MP3 audio like the dual-file local workflow', async () => {
    const preset: WorkflowPreset = {
      version: 1,
      name: 'Dual source MP4+MP3 mux',
      nodes: [
        { id: 'video-file', type: 'file_loader' },
        { id: 'video-analyze', type: 'auto_analyze' },
        { id: 'video-track', type: 'track_select', params: { kind: 'video', trackIndex: 0 } },
        { id: 'video-select', type: 'media_select' },
        { id: 'audio-file', type: 'file_loader' },
        { id: 'audio-analyze', type: 'auto_analyze' },
        { id: 'audio-track', type: 'track_select', params: { kind: 'audio', trackIndex: 0 } },
        { id: 'audio-select', type: 'media_select' },
        {
          id: 'mux',
          type: 'mp4_muxer',
          params: { fileName: 'output.mp4', alignMode: 'trim_to_video' },
        },
        { id: 'play', type: 'mp4_player' },
      ],
      edges: [
        { id: 'v1', sourceNodeId: 'video-file', sourceOutput: 'source', targetNodeId: 'video-analyze', targetInput: 'source' },
        { id: 'v2', sourceNodeId: 'video-analyze', sourceOutput: 'asset', targetNodeId: 'video-track', targetInput: 'asset' },
        { id: 'v3', sourceNodeId: 'video-track', sourceOutput: 'selectedTrack', targetNodeId: 'video-select', targetInput: 'source' },
        { id: 'v4', sourceNodeId: 'video-select', sourceOutput: 'selection', targetNodeId: 'mux', targetInput: 'video' },
        { id: 'a1', sourceNodeId: 'audio-file', sourceOutput: 'source', targetNodeId: 'audio-analyze', targetInput: 'source' },
        { id: 'a2', sourceNodeId: 'audio-analyze', sourceOutput: 'asset', targetNodeId: 'audio-track', targetInput: 'asset' },
        { id: 'a3', sourceNodeId: 'audio-track', sourceOutput: 'selectedTrack', targetNodeId: 'audio-select', targetInput: 'source' },
        { id: 'a4', sourceNodeId: 'audio-select', sourceOutput: 'selection', targetNodeId: 'mux', targetInput: 'audio' },
        { id: 'p1', sourceNodeId: 'mux', sourceOutput: 'file', targetNodeId: 'play', targetInput: 'source' },
      ],
    };

    const videoSource = sourceFromFixture('tests/generated-av.mp4');
    const audioSource = sourceFromFixture('tests/Duvet.mp3');
    const results = await runDualSourcePreset(preset, videoSource, audioSource);

    const file = results.get('mux')?.get('file') as MediaFile | undefined;
    expect(file?.data.byteLength).toBeGreaterThan(1024);
    expect(isMp4OrFmp4Signature(file!.data)).toBe(true);
    expect(Number(file?.metadata.audioSampleCount)).toBeGreaterThan(0);

    const preview = JSON.parse(String(results.get('play')?.get('preview')));
    expect(preview.durationMs).toBeGreaterThan(0);
  });
});

async function runPreset(
  preset: WorkflowPreset,
  source: MediaSource,
) {
  const sourceNode: NodeDefinition = {
    ...fileLoaderNode,
    async execute() {
      return { source };
    },
  } as NodeDefinition;
  const graph = instantiateWorkflowPreset(preset, {
    nodeOverrides: new Map([['file', sourceNode]]),
  });
  return executeGraph(
    graph,
    createMemoryCache(),
    new AbortController().signal,
  );
}

async function runDualSourcePreset(
  preset: WorkflowPreset,
  videoSource: MediaSource,
  audioSource: MediaSource,
) {
  const videoLoader: NodeDefinition = {
    ...fileLoaderNode,
    async execute() {
      return { source: videoSource };
    },
  } as NodeDefinition;
  const audioLoader: NodeDefinition = {
    ...fileLoaderNode,
    async execute() {
      return { source: audioSource };
    },
  } as NodeDefinition;
  const graph = instantiateWorkflowPreset(preset, {
    nodeOverrides: new Map([
      ['video-file', videoLoader],
      ['audio-file', audioLoader],
    ]),
  });
  return executeGraph(
    graph,
    createMemoryCache(),
    new AbortController().signal,
  );
}

function sourceFromFixture(relativePath: string): MediaSource {
  const data = new Uint8Array(readFileSync(join(root, relativePath)));
  const sha256 = createHash('sha256').update(data).digest('hex');
  return {
    sourceId: `fixture:${sha256}`,
    version: sha256,
    kind: 'file',
    name: relativePath,
    size: data.byteLength,
    data,
    metadata: {},
  };
}

function readPreset(fileName: string): WorkflowPreset {
  return JSON.parse(
    readFileSync(join(workflowsDir, fileName), 'utf8'),
  ) as WorkflowPreset;
}
