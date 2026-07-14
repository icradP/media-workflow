import type {
  ControlEvent,
  ControlHandle,
  WebAudioChainStep,
  WebAudioHandle,
  WebAudioNodeKind,
} from '@media-workflow/core';

export function createWebAudioHandle(
  kind: WebAudioNodeKind,
  nodeDefinitionId: string,
  params: Record<string, unknown>,
  options?: {
    label?: string;
    upstream?: WebAudioHandle;
  },
): WebAudioHandle {
  const step: WebAudioChainStep = {
    kind,
    nodeDefinitionId,
    params: { ...params },
  };
  const chain = options?.upstream
    ? [...options.upstream.chain, step]
    : [step];

  return {
    handleId: `${nodeDefinitionId}:${kind}:${chain.length}`,
    kind,
    nodeDefinitionId,
    label: options?.label,
    params: { ...params },
    chain,
  };
}

export function isWebAudioHandle(value: unknown): value is WebAudioHandle {
  return Boolean(
    value
    && typeof value === 'object'
    && 'handleId' in value
    && 'kind' in value
    && 'nodeDefinitionId' in value
    && Array.isArray((value as WebAudioHandle).chain),
  );
}

export function requireWebAudio(input: unknown, label: string): WebAudioHandle {
  if (!isWebAudioHandle(input)) {
    throw new Error(`${label}: webaudio input is required (connect upstream or use Live Play)`);
  }
  return input;
}

export function createControlHandle(
  nodeDefinitionId: string,
  options?: {
    label?: string;
    params?: Record<string, unknown>;
    lastEvent?: ControlEvent;
  },
): ControlHandle {
  const label = options?.label;
  return {
    controlId: `${nodeDefinitionId}:${label ?? 'control'}:${Date.now()}`,
    nodeDefinitionId,
    label,
    lastEvent: options?.lastEvent,
    params: { ...(options?.params ?? {}) },
  };
}

export function isControlHandle(value: unknown): value is ControlHandle {
  return Boolean(
    value
    && typeof value === 'object'
    && 'controlId' in value
    && 'nodeDefinitionId' in value,
  );
}

export const REALTIME_NODE_IDS = [
  'trigger_button',
  'ring_buffer_source',
  'audio_gain',
  'audio_biquadfilter',
  'audio_analyser',
  'audio_destination',
  'audio_visualization',
  'webaudio_to_pcm',
] as const;

export type RealtimeNodeId = (typeof REALTIME_NODE_IDS)[number];

export function isRealtimeNodeId(id: string): id is RealtimeNodeId {
  return (REALTIME_NODE_IDS as readonly string[]).includes(id);
}

/** Nodes that participate in Live Play wiring (realtime + merged live sources). */
export function isLiveGraphNodeId(id: string): boolean {
  return id === 'device_capture' || id === 'mp4_muxer' || isRealtimeNodeId(id);
}
