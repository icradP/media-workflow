import type { MediaSample, PcmAudioClip } from '@media-workflow/core';
import { float32InterleavedToPlanar } from '../decode/pcm.js';
import { trimPcmToRange } from '../planner/audio.js';

export function isWebAudioDecodeAvailable(): boolean {
  return typeof globalThis.AudioContext !== 'undefined' ||
    typeof globalThis.OfflineAudioContext !== 'undefined';
}

export async function decodeMp3SamplesToPcm(options: {
  samples: MediaSample[];
  rangeStartUs: number;
  rangeEndUs: number;
  sourceTrackId: string;
  requestId: string;
  sampleRate?: number;
  channels?: number;
}): Promise<PcmAudioClip> {
  if (!isWebAudioDecodeAvailable()) {
    throw new Error('MP3 decode requires Web Audio (AudioContext) in this environment');
  }

  const sorted = [...options.samples].sort(
    (left, right) => left.ptsUs - right.ptsUs || left.index - right.index,
  );
  const mp3Bytes = concatSampleBytes(sorted);
  if (mp3Bytes.byteLength === 0) {
    throw new Error('MP3 decode: no encoded sample bytes available');
  }

  const AudioContextCtor = globalThis.AudioContext ??
    globalThis.OfflineAudioContext;
  const context = new AudioContextCtor() as AudioContext;
  try {
    const copy = new Uint8Array(mp3Bytes);
    const buffer = await context.decodeAudioData(copy.buffer.slice(0));
    const frameChannels = buffer.numberOfChannels;
    const frameCount = buffer.length;
    const merged = new Float32Array(frameCount * frameChannels);
    for (let channel = 0; channel < frameChannels; channel++) {
      const channelData = buffer.getChannelData(channel);
      for (let sample = 0; sample < frameCount; sample++) {
        merged[sample * frameChannels + channel] = channelData[sample]!;
      }
    }

    const planes = float32InterleavedToPlanar(merged, frameChannels);
    const trimmed = trimPcmToRange({
      planes,
      sampleRate: buffer.sampleRate,
      channels: frameChannels,
      ptsUs: sorted[0]?.ptsUs ?? options.rangeStartUs,
      rangeStartUs: options.rangeStartUs,
      rangeEndUs: options.rangeEndUs,
    });

    return {
      clipId: `${options.requestId}:pcm`,
      sourceTrackId: options.sourceTrackId,
      ptsUs: trimmed.ptsUs,
      durationUs: trimmed.durationUs,
      sampleRate: buffer.sampleRate,
      channels: frameChannels,
      sampleCount: trimmed.sampleCount,
      format: 'f32-planar',
      planes: trimmed.planes,
      backend: {
        id: 'webaudio-mp3',
        version: '1.0.0',
        api: 'software',
        codecFamilies: ['mp3'],
        inputFormats: ['mp3'],
        outputFormats: ['f32-planar'],
        hardwareAcceleration: 'software',
      },
      diagnostics: [],
    };
  } finally {
    await context.close();
  }
}

function concatSampleBytes(samples: MediaSample[]): Uint8Array {
  const chunks = samples
    .map(sample => sample.data)
    .filter((data): data is Uint8Array => !!data?.byteLength);
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}
