import type { PcmAudioClip } from '@media-workflow/core';
import { float32PlanarToInterleaved } from '../decode/pcm.js';

export interface AacEncodedPacket {
  data: Uint8Array;
  ptsUs: number;
  durationUs: number;
  isKey: boolean;
}

export interface AacEncodeResult {
  packets: AacEncodedPacket[];
  codecConfig: Uint8Array;
  sampleRate: number;
  channels: number;
  codec: string;
}

export interface AacEncodeOptions {
  bitrate?: number;
  signal?: AbortSignal;
}

export function isWebCodecsAacEncoderAvailable(): boolean {
  return typeof globalThis.AudioEncoder !== 'undefined' &&
    typeof globalThis.AudioData !== 'undefined';
}

export async function encodePcmToAac(
  pcm: PcmAudioClip,
  options: AacEncodeOptions = {},
): Promise<AacEncodeResult> {
  if (!isWebCodecsAacEncoderAvailable()) {
    throw new Error('AAC encode requires WebCodecs AudioEncoder in this environment');
  }
  if (pcm.format !== 'f32-planar' || pcm.sampleCount <= 0) {
    throw new Error('AAC encode: PCM clip must contain planar Float32 samples');
  }

  const bitrate = Math.max(32_000, Number(options.bitrate) || 128_000);
  const packets: AacEncodedPacket[] = [];
  let codecConfig: Uint8Array | undefined;
  let codec = 'mp4a.40.2';

  const encoder = new AudioEncoder({
    output: (chunk, metadata) => {
      const decoderConfig = metadata?.decoderConfig;
      if (decoderConfig?.description) {
        codecConfig = new Uint8Array(decoderConfig.description as ArrayBuffer);
        codec = decoderConfig.codec ?? codec;
      }
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      packets.push({
        data,
        ptsUs: Math.round(chunk.timestamp),
        durationUs: Math.max(1, Math.round(chunk.duration ?? 0)),
        isKey: chunk.type === 'key',
      });
    },
    error: error => {
      throw error;
    },
  });

  encoder.configure({
    codec: 'mp4a.40.2',
    sampleRate: pcm.sampleRate,
    numberOfChannels: pcm.channels,
    bitrate,
  });

  const frameSize = 1024;
  const interleaved = float32PlanarToInterleaved(pcm.planes, pcm.channels, pcm.sampleCount);
  let offset = 0;
  while (offset < pcm.sampleCount) {
    if (options.signal?.aborted) break;
    const frames = Math.min(frameSize, pcm.sampleCount - offset);
    const slice = interleaved.subarray(
      offset * pcm.channels,
      (offset + frames) * pcm.channels,
    );
    const audioData = new AudioData({
      format: 'f32',
      sampleRate: pcm.sampleRate,
      numberOfFrames: frames,
      numberOfChannels: pcm.channels,
      timestamp: pcm.ptsUs + Math.round((offset / pcm.sampleRate) * 1_000_000),
      data: new Float32Array(slice),
    });
    encoder.encode(audioData);
    audioData.close();
    offset += frames;
  }

  await encoder.flush();
  encoder.close();

  if (!codecConfig || codecConfig.byteLength === 0) {
    throw new Error('AAC encode: encoder did not emit AudioSpecificConfig');
  }
  if (packets.length === 0) {
    throw new Error('AAC encode: encoder produced no packets');
  }

  return {
    packets,
    codecConfig,
    sampleRate: pcm.sampleRate,
    channels: pcm.channels,
    codec,
  };
}
