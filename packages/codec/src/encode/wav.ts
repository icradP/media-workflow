import type { PcmAudioClip } from '@media-workflow/core';

export type WavSampleFormat = 'pcm16' | 'float32';

export function encodeWav(
  clip: PcmAudioClip,
  format: WavSampleFormat = 'pcm16',
): Uint8Array {
  const channels = clip.channels;
  const sampleRate = clip.sampleRate;
  const sampleCount = clip.sampleCount;
  const bytesPerSample = format === 'float32' ? 4 : 2;
  const blockAlign = channels * bytesPerSample;
  const dataSize = sampleCount * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format === 'float32' ? 3 : 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  const dataOffset = 44;
  if (format === 'float32') {
    let offset = dataOffset;
    for (let sample = 0; sample < sampleCount; sample++) {
      for (let channel = 0; channel < channels; channel++) {
        view.setFloat32(offset, clip.planes[channel]?.[sample] ?? 0, true);
        offset += 4;
      }
    }
  } else {
    let offset = dataOffset;
    for (let sample = 0; sample < sampleCount; sample++) {
      for (let channel = 0; channel < channels; channel++) {
        const value = Math.max(-1, Math.min(1, clip.planes[channel]?.[sample] ?? 0));
        view.setInt16(offset, Math.round(value * 32_767), true);
        offset += 2;
      }
    }
  }

  return new Uint8Array(buffer);
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index++) {
    view.setUint8(offset + index, text.charCodeAt(index)!);
  }
}
