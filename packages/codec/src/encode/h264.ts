import type { DecodedVideoClip, DecodedVideoFrame } from '@media-workflow/core';
import { annexBToAvcc } from '../decode/bitstream.js';
import {
  annexBToLengthPrefixed,
  hasAnnexBStartCode,
  splitLengthPrefixedNalUnits,
} from '../nalu/annexb.js';

export interface H264EncodedPacket {
  data: Uint8Array;
  ptsUs: number;
  dtsUs: number;
  durationUs: number;
  isKey: boolean;
}

export interface H264EncodeResult {
  packets: H264EncodedPacket[];
  codecConfig: Uint8Array;
  width: number;
  height: number;
  codec: string;
}

export interface H264EncodeOptions {
  bitrate?: number;
  signal?: AbortSignal;
}

export function isWebCodecsH264EncoderAvailable(): boolean {
  return typeof globalThis.VideoEncoder !== 'undefined' &&
    typeof globalThis.VideoFrame !== 'undefined';
}

export async function encodeDecodedVideoToH264(
  clip: DecodedVideoClip,
  options: H264EncodeOptions = {},
): Promise<H264EncodeResult> {
  if (!isWebCodecsH264EncoderAvailable()) {
    throw new Error('H.264 encode requires WebCodecs VideoEncoder in this environment');
  }
  if (clip.frames.length === 0) {
    throw new Error('H.264 encode: decoded clip contains no frames');
  }

  const first = clip.frames[0]!;
  const width = first.displayWidth || first.codedWidth;
  const height = first.displayHeight || first.codedHeight;
  const bitrate = Math.max(250_000, Number(options.bitrate) || 2_000_000);
  const packets: H264EncodedPacket[] = [];
  let codecConfig: Uint8Array | undefined;
  let codec = 'avc1.42E01E';

  const encoder = new VideoEncoder({
    output: (chunk, metadata) => {
      const decoderConfig = metadata?.decoderConfig;
      if (decoderConfig?.description) {
        codecConfig = new Uint8Array(decoderConfig.description as ArrayBuffer);
        codec = decoderConfig.codec ?? codec;
      }
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      const normalized = normalizeH264EncoderOutput(data);
      const timestamp = Math.round(chunk.timestamp);
      packets.push({
        data: normalized,
        ptsUs: timestamp,
        dtsUs: timestamp,
        durationUs: Math.max(1, Math.round(chunk.duration ?? 0)),
        isKey: chunk.type === 'key',
      });
    },
    error: error => {
      throw error;
    },
  });

  encoder.configure({
    codec: 'avc1.42E01E',
    width,
    height,
    bitrate,
    framerate: inferFrameRate(clip.frames),
    avc: { format: 'avc' },
  } as VideoEncoderConfig);

  for (const [index, frame] of clip.frames.entries()) {
    if (options.signal?.aborted) break;
    const videoFrame = decodedFrameToVideoFrame(frame);
    encoder.encode(videoFrame, { keyFrame: index === 0 || frame.metadata.isKey === true });
    videoFrame.close();
  }

  await encoder.flush();
  encoder.close();

  if (!codecConfig || codecConfig.byteLength === 0) {
    throw new Error('H.264 encode: encoder did not emit avcC configuration');
  }
  if (packets.length === 0) {
    throw new Error('H.264 encode: encoder produced no packets');
  }

  return {
    packets,
    codecConfig,
    width,
    height,
    codec,
  };
}

/** WebCodecs avc1 emits AVCC; only convert when the chunk is not valid length-prefixed data. */
export function normalizeH264EncoderOutput(data: Uint8Array): Uint8Array {
  if (splitLengthPrefixedNalUnits(data, 4)) return data;
  if (!hasAnnexBStartCode(data)) return data;
  return annexBToLengthPrefixed(data) ?? annexBToAvcc(data);
}

function inferFrameRate(frames: DecodedVideoFrame[]): number {
  if (frames.length < 2) return 30;
  const durationUs = Math.max(
    1,
    (frames.at(-1)!.ptsUs - frames[0]!.ptsUs) + (frames.at(-1)!.durationUs ?? 0),
  );
  return Math.max(1, Math.round((frames.length * 1_000_000) / durationUs));
}

function decodedFrameToVideoFrame(frame: DecodedVideoFrame): VideoFrame {
  const [y, u, v] = frame.planes;
  if (!y || !u || !v) {
    throw new Error('H.264 encode: decoded frame is missing I420 planes');
  }
  const width = frame.displayWidth || frame.codedWidth;
  const height = frame.displayHeight || frame.codedHeight;
  const uvWidth = Math.ceil(width / 2);
  const uvHeight = Math.ceil(height / 2);
  const expectedY = width * height;
  const expectedUv = uvWidth * uvHeight;
  if (y.byteLength !== expectedY || u.byteLength !== expectedUv || v.byteLength !== expectedUv) {
    throw new Error(
      `H.264 encode: I420 plane size mismatch for ${width}x${height} `
      + `(y=${y.byteLength}, u=${u.byteLength}, v=${v.byteLength})`,
    );
  }

  const data = new Uint8Array(y.byteLength + u.byteLength + v.byteLength);
  data.set(y, 0);
  data.set(u, y.byteLength);
  data.set(v, y.byteLength + u.byteLength);
  return new VideoFrame(data, {
    format: 'I420',
    codedWidth: width,
    codedHeight: height,
    timestamp: frame.ptsUs,
    duration: frame.durationUs,
    layout: [
      { offset: 0, stride: width },
      { offset: y.byteLength, stride: uvWidth },
      { offset: y.byteLength + u.byteLength, stride: uvWidth },
    ],
  });
}
