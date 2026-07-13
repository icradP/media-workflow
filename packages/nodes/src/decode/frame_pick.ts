import type {
  DecodedVideoClip,
  DecodedVideoFrame,
} from '@media-workflow/core';

export interface DecodedFramePick {
  mode?: 'first' | 'index' | 'sample_id' | 'pts';
  index?: number;
  sampleId?: string;
  ptsUs?: number;
}

export function pickDecodedFrame(
  clip: DecodedVideoClip,
  pick: DecodedFramePick,
): DecodedVideoFrame {
  if (clip.frames.length === 0) {
    throw new Error('Decoded video contains no frames');
  }

  const mode = pick.mode ?? 'first';
  if (mode === 'index') {
    const index = Math.min(
      clip.frames.length - 1,
      Math.max(0, Math.floor(pick.index ?? 0)),
    );
    return clip.frames[index]!;
  }

  if (mode === 'sample_id') {
    const sampleId = pick.sampleId ?? '';
    const frame = clip.frames.find(candidate => candidate.sourceSampleId === sampleId);
    if (!frame) throw new Error(`Decoded video has no frame for sample ${sampleId}`);
    return frame;
  }

  if (mode === 'pts') {
    const ptsUs = pick.ptsUs ?? 0;
    return clip.frames.reduce((nearest, candidate) =>
      Math.abs(candidate.ptsUs - ptsUs) < Math.abs(nearest.ptsUs - ptsUs)
        ? candidate
        : nearest,
    );
  }

  return clip.frames[0]!;
}
