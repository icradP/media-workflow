import type {
  BitstreamFormat,
  CodecFamily,
  DecoderBackendInfo,
  DecodedVideoPixelFormat,
} from '@media-workflow/core';

export interface DecoderCapability extends DecoderBackendInfo {
  supports(codecFamily: CodecFamily, bitstreamFormat: BitstreamFormat): boolean;
}

export const WEBCODECS_H264_BACKEND: DecoderCapability = {
  id: 'webcodecs-h264',
  version: '1.0.0',
  api: 'webcodecs',
  codecFamilies: ['h264'],
  inputFormats: ['avcc', 'annexb'],
  outputFormats: ['I420', 'NV12'],
  hardwareAcceleration: 'unknown',
  supports(codecFamily, bitstreamFormat) {
    return codecFamily === 'h264' &&
      (bitstreamFormat === 'avcc' || bitstreamFormat === 'annexb');
  },
};

export const WEBCODECS_AAC_BACKEND: DecoderCapability = {
  id: 'webcodecs-aac',
  version: '1.0.0',
  api: 'webcodecs',
  codecFamilies: ['aac'],
  inputFormats: ['aac_raw', 'adts'],
  outputFormats: ['f32-planar'],
  hardwareAcceleration: 'unknown',
  supports(codecFamily, bitstreamFormat) {
    return codecFamily === 'aac' &&
      (bitstreamFormat === 'aac_raw' || bitstreamFormat === 'adts');
  },
};

export const G711_SOFTWARE_BACKEND: DecoderCapability = {
  id: 'g711-software',
  version: '1.0.0',
  api: 'software',
  codecFamilies: ['g711'],
  inputFormats: ['g711_alaw', 'g711_ulaw'],
  outputFormats: ['f32-planar'],
  hardwareAcceleration: 'software',
  supports(codecFamily, bitstreamFormat) {
    return codecFamily === 'g711' &&
      (bitstreamFormat === 'g711_alaw' || bitstreamFormat === 'g711_ulaw');
  },
};

export const DECODER_CAPABILITIES: DecoderCapability[] = [
  WEBCODECS_H264_BACKEND,
  WEBCODECS_AAC_BACKEND,
  G711_SOFTWARE_BACKEND,
];

export function findDecoderCapability(
  codecFamily: CodecFamily,
  bitstreamFormat: BitstreamFormat,
  preferredApi?: DecoderBackendInfo['api'],
): DecoderCapability | undefined {
  const matches = DECODER_CAPABILITIES.filter(capability =>
    capability.supports(codecFamily, bitstreamFormat),
  );
  if (preferredApi) {
    const preferred = matches.find(capability => capability.api === preferredApi);
    if (preferred) return preferred;
  }
  return matches[0];
}

export interface DecoderWorkerRequest {
  type: 'decode_video' | 'decode_audio';
  requestId: string;
  backendId: string;
  payload: unknown;
}

export interface DecoderWorkerResponse {
  type: 'result' | 'error';
  requestId: string;
  backendId: string;
  payload?: unknown;
  error?: string;
  transferables?: ArrayBuffer[];
}

export function extractTransferablesFromDecodedOutput(
  output: Record<string, unknown>,
): ArrayBuffer[] {
  const transferables: ArrayBuffer[] = [];
  for (const value of Object.values(output)) {
    collectTransferables(value, transferables);
  }
  return transferables;
}

function collectTransferables(value: unknown, transferables: ArrayBuffer[]): void {
  if (!value || typeof value !== 'object') return;

  if ('planes' in value && Array.isArray((value as { planes: unknown[] }).planes)) {
    for (const plane of (value as { planes: ArrayBufferView[] }).planes) {
      if (plane?.buffer instanceof ArrayBuffer) {
        transferables.push(plane.buffer);
      }
    }
  }

  if ('frames' in value && Array.isArray((value as { frames: unknown[] }).frames)) {
    for (const frame of (value as { frames: Array<{ planes?: ArrayBufferView[] }> }).frames) {
      for (const plane of frame.planes ?? []) {
        if (plane?.buffer instanceof ArrayBuffer) {
          transferables.push(plane.buffer);
        }
      }
    }
  }

  if ('data' in value && (value as { data: unknown }).data instanceof Uint8Array) {
    const data = (value as { data: Uint8Array }).data;
    if (data.buffer instanceof ArrayBuffer && data.byteOffset === 0) {
      transferables.push(data.buffer);
    }
  }
}

export const DEFAULT_VIDEO_OUTPUT_FORMAT: DecodedVideoPixelFormat = 'I420';

/**
 * Soft caps for browser eager-decode memory.
 * Prefer EncodedTrack → Ring stream-decode for long clips (no full I420 materialization).
 * 7200 ≈ 4min @ 30fps (or ~2min @ 60fps). Beyond this, eager requests truncate with a warning.
 */
export const DECODE_LIMITS = {
  maxVideoFrames: 7_200,
  maxVideoPixels: 1920 * 1080 * 7_200,
  /** Browser-side guard against excessive PCM allocation (~110 MB at 48 kHz stereo). */
  maxAudioDurationUs: 5 * 60 * 1_000_000,
} as const;
