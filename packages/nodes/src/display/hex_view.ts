import type { NodeDefinition } from '@media-workflow/core';
import type {
  ByteData,
  DecodedVideoClip,
  EncodedPacket,
  MediaSample,
  PcmAudioClip,
} from '@media-workflow/core';
import { toHex } from '@media-workflow/codec';

/**
 * HexView — 以十六进制表格形式显示原始字节。
 *
 * Inputs:  data (buffer)
 * Outputs: preview (供 UI viewport 渲染)
 */
export const hexViewNode: NodeDefinition<
  { bytes: 'byte_data' },
  { preview: 'string' }
> = {
  id: 'hex_view',
  category: 'inspect',
  displayName: 'Hex View',
  description: 'Display raw bytes in hexadecimal format with offset/ASCII columns.',
  inputs: {
    bytes: { type: 'byte_data', label: 'Any Byte Data' },
  },
  outputs: {
    preview: { type: 'string', label: 'Hex Preview' },
  },
  params: {
    offset: { name: 'offset', type: 'number', default: 0, min: 0, step: 1 },
    length: { name: 'length', type: 'number', default: 256, min: 1, max: 4096, step: 16 },
  },
  async execute(ctx, { inputs, params }) {
    const value = inputs.bytes as ByteData | undefined;
    if (!value) throw new Error('HexView: no byte-producing input');

    const view = extractByteView(value);
    const relativeOffset = Math.min(
      view.data.byteLength,
      Math.max(0, Math.floor(Number(params.offset) || 0)),
    );
    const length = Math.min(
      4096,
      Math.max(1, Math.floor(Number(params.length) || 256)),
    );
    const slice = view.data.subarray(
      relativeOffset,
      Math.min(view.data.byteLength, relativeOffset + length),
    );
    const hex = toHex(slice);
    ctx.log.info(`HexView: ${slice.byteLength} bytes`);
    return {
      preview: JSON.stringify({
        offset: view.baseOffset + relativeOffset,
        byteLength: slice.byteLength,
        sourceType: view.sourceType,
        hex,
        ascii: toAscii(slice),
      }),
    };
  },
};

interface ExtractedByteView {
  data: Uint8Array;
  baseOffset: number;
  sourceType: string;
}

export function extractByteView(value: ByteData): ExtractedByteView {
  if (value instanceof Uint8Array) {
    return { data: value, baseOffset: 0, sourceType: 'Uint8Array' };
  }

  if (Array.isArray(value)) {
    if (isEncodedPacketArray(value)) {
      return extractFromPackets(value, `EncodedPacket[${value.length}]`);
    }
    return extractFromSamples(value as MediaSample[], `MediaSample[${value.length}]`);
  }

  if ('selectionId' in value && 'samples' in value && Array.isArray(value.samples)) {
    return extractFromSamples(value.samples, `MediaSelection[${value.samples.length}]`);
  }

  if ('selectedTrackId' in value && 'samples' in value && Array.isArray(value.samples)) {
    return extractFromSamples(value.samples, `SelectedTrack[${value.samples.length}]`);
  }

  if ('sourceId' in value && 'data' in value && value.data instanceof Uint8Array) {
    return { data: value.data, baseOffset: 0, sourceType: 'MediaSource' };
  }

  if ('fileName' in value && 'data' in value && value.data instanceof Uint8Array) {
    return { data: value.data, baseOffset: 0, sourceType: 'MediaFile' };
  }

  if ('source' in value && value.source?.data instanceof Uint8Array) {
    return {
      data: value.source.data,
      baseOffset: 0,
      sourceType: 'MediaAsset.source',
    };
  }

  if (isDecodedVideoClip(value)) {
    const chunks = value.frames.flatMap(frame => frame.planes);
    return {
      data: concatenate(chunks),
      baseOffset: 0,
      sourceType: `DecodedVideoClip[${value.frames.length}]`,
    };
  }

  if (hasPcmPlanes(value)) {
    const chunks = value.planes.map(plane =>
      new Uint8Array(plane.buffer, plane.byteOffset, plane.byteLength),
    );
    return {
      data: concatenate(chunks),
      baseOffset: 0,
      sourceType: 'PcmAudioClip.f32-planar',
    };
  }

  if ('planes' in value && Array.isArray((value as { planes: unknown }).planes)) {
    const planes = (value as { planes: Uint8Array[]; format?: unknown }).planes;
    const format = 'format' in value ? String((value as { format?: unknown }).format) : 'VideoFrameData';
    return {
      data: concatenate(planes),
      baseOffset: 0,
      sourceType: `DecodedFrame.${format}`,
    };
  }

  if ('packets' in value && Array.isArray(value.packets)) {
    return extractFromPackets(value.packets, `EncodedTrack.${value.trackId}`);
  }

  if ('units' in value && Array.isArray(value.units)) {
    return {
      data: concatenate(value.units.map(unit => unit.data)),
      baseOffset: value.units[0]?.offset ?? 0,
      sourceType: `NalUnitData.${value.codec}`,
    };
  }

  if ('codec' in value && 'data' in value && value.data instanceof Uint8Array && 'dts' in value) {
    return {
      data: value.data,
      baseOffset: 0,
      sourceType: `CompressedFrame.${value.codec}`,
    };
  }

  if ('uuid' in value && 'data' in value && value.data instanceof Uint8Array) {
    return {
      data: value.data,
      baseOffset: 0,
      sourceType: 'SeiPayload',
    };
  }

  if ('packetId' in value && 'data' in value && value.data instanceof Uint8Array) {
    return {
      data: value.data,
      baseOffset: 0,
      sourceType: `EncodedPacket.${value.packetId}`,
    };
  }

  if ('data' in value && ArrayBuffer.isView(value.data)) {
    const data = new Uint8Array(
      value.data.buffer,
      value.data.byteOffset,
      value.data.byteLength,
    );
    const validLength = 'byteLength' in value
      ? Math.min(data.byteLength, Number(value.byteLength) || data.byteLength)
      : data.byteLength;
    return {
      data: data.subarray(0, validLength),
      baseOffset: 'byteOffset' in value ? Number(value.byteOffset) || 0 : 0,
      sourceType: value.constructor?.name || 'ByteData',
    };
  }

  throw new Error('HexView: input does not expose readable bytes');
}

function extractFromSamples(
  samples: MediaSample[],
  sourceType: string,
): ExtractedByteView {
  const chunks = samples
    .map(sample => sample.data)
    .filter((data): data is Uint8Array => data instanceof Uint8Array);
  return {
    data: concatenate(chunks),
    baseOffset: samples[0]?.offset ?? 0,
    sourceType,
  };
}

function extractFromPackets(
  packets: EncodedPacket[],
  sourceType: string,
): ExtractedByteView {
  return {
    data: concatenate(packets.map(packet => packet.data)),
    baseOffset: 0,
    sourceType,
  };
}

function isEncodedPacketArray(value: unknown[]): value is EncodedPacket[] {
  const first = value[0];
  return Boolean(
    first &&
    typeof first === 'object' &&
    'packetId' in first &&
    'bitstreamFormat' in first,
  );
}

function isDecodedVideoClip(value: ByteData): value is DecodedVideoClip {
  return typeof value === 'object' &&
    value !== null &&
    'requestId' in value &&
    'frames' in value &&
    Array.isArray(value.frames);
}

function hasPcmPlanes(value: ByteData): value is PcmAudioClip {
  return typeof value === 'object' &&
    value !== null &&
    'format' in value &&
    value.format === 'f32-planar' &&
    'planes' in value &&
    Array.isArray(value.planes);
}

function concatenate(chunks: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function toAscii(bytes: Uint8Array): string {
  return Array.from(bytes, b => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
}
