import type {
  AudioDecodeRequest,
  ExecuteContext,
  PcmAudioClip,
} from '@media-workflow/core';
import { g711DecoderNode } from './g711.js';
import { webcodecsAudioDecoderNode } from './webcodecs_audio.js';

export async function decodeAudioRequestToPcm(
  ctx: ExecuteContext,
  request: AudioDecodeRequest,
): Promise<PcmAudioClip> {
  const decoder = request.track.codecFamily === 'g711'
    ? g711DecoderNode
    : webcodecsAudioDecoderNode;
  const result = await decoder.execute(ctx, {
    inputs: { request },
    params: {},
  });
  return result.pcm as PcmAudioClip;
}
