import type { PcmAudioClip } from '@media-workflow/core';

export interface ResamplePcmOptions {
  sampleRate: number;
}

function resamplePlane(
  source: Float32Array,
  sourceCount: number,
  targetCount: number,
): Float32Array {
  const out = new Float32Array(targetCount);
  if (sourceCount <= 0) return out;
  if (targetCount <= 1) {
    out[0] = source[0] ?? 0;
    return out;
  }
  if (sourceCount === 1) {
    out.fill(source[0] ?? 0);
    return out;
  }

  for (let index = 0; index < targetCount; index++) {
    const position = (index / (targetCount - 1)) * (sourceCount - 1);
    const left = Math.floor(position);
    const fraction = position - left;
    const a = source[left] ?? 0;
    const b = source[Math.min(left + 1, sourceCount - 1)] ?? 0;
    out[index] = a + (b - a) * fraction;
  }
  return out;
}

export function resamplePcmClip(
  clip: PcmAudioClip,
  options: ResamplePcmOptions,
): PcmAudioClip {
  const targetSampleRate = Math.floor(Number(options.sampleRate));
  if (!Number.isFinite(targetSampleRate) || targetSampleRate <= 0) {
    throw new Error(`PCM resample: invalid target sample rate ${options.sampleRate}`);
  }
  if (clip.sampleRate === targetSampleRate) return clip;
  if (clip.format !== 'f32-planar') {
    throw new Error(`PCM resample: unsupported PCM format ${clip.format}`);
  }

  const sourceCount = clip.sampleCount;
  const targetSampleCount = Math.max(
    1,
    Math.round(sourceCount * (targetSampleRate / clip.sampleRate)),
  );
  const durationUs = clip.durationUs > 0
    ? clip.durationUs
    : Math.round((sourceCount / clip.sampleRate) * 1_000_000);

  const planes = clip.planes.map(plane =>
    resamplePlane(plane, sourceCount, targetSampleCount),
  );

  return {
    ...clip,
    clipId: `${clip.clipId}:resample@${targetSampleRate}`,
    sampleRate: targetSampleRate,
    sampleCount: targetSampleCount,
    durationUs,
    planes,
  };
}
