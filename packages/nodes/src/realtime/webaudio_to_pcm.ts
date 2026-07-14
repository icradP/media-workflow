import type { NodeDefinition, PcmAudioClip, WebAudioHandle } from '@media-workflow/core';
import { renderPcmThroughWebAudioChain } from '@media-workflow/codec';
import { requireWebAudio } from './handles.js';

export const webaudioToPcmNode: NodeDefinition<
  { in: 'webaudio'; pcm: 'pcm_audio' },
  { pcm: 'pcm_audio' }
> = {
  id: 'webaudio_to_pcm',
  category: 'realtime',
  displayName: 'WebAudio → PCM',
  description:
    'Offline-bake dry PCM through the upstream Web Audio effect chain into reusable pcm_audio.',
  inputs: {
    in: { type: 'webaudio', label: 'Web Audio Chain' },
    pcm: { type: 'pcm_audio', label: 'Dry PCM' },
  },
  outputs: {
    pcm: { type: 'pcm_audio', label: 'Processed PCM' },
  },
  params: {
    maxDurationSeconds: {
      name: 'maxDurationSeconds',
      type: 'number',
      default: 120,
      min: 1,
      max: 600,
      step: 1,
    },
  },
  cachePolicy: 'never',
  async execute(ctx, { inputs, params }) {
    const handle = requireWebAudio(inputs.in, 'WebAudioToPcm') as WebAudioHandle;
    const pcm = inputs.pcm as PcmAudioClip | undefined;
    if (!pcm) {
      throw new Error('WebAudioToPcm: dry pcm_audio input is required (e.g. from Audio Decode)');
    }

    const baked = await renderPcmThroughWebAudioChain(pcm, handle, {
      maxDurationSeconds: Number(params.maxDurationSeconds) || 120,
    });

    ctx.log.info(
      `WebAudioToPcm: ${pcm.sampleCount} → ${baked.sampleCount} sample(s) · `
      + `${handle.chain.length} stage(s)`,
    );
    return { pcm: baked };
  },
};
