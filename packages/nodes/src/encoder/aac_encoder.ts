import type { MediaSelection, NodeDefinition, PcmAudioClip } from '@media-workflow/core';
import {
  buildAacMediaSelection,
  encodePcmToAac,
  isWebCodecsAacEncoderAvailable,
} from '@media-workflow/codec';

export const aacEncoderNode: NodeDefinition<
  { pcm: 'pcm_audio'; selection: 'media_selection' },
  { selection: 'media_selection' }
> = {
  id: 'aac_encoder',
  category: 'transform',
  displayName: 'AAC Encoder',
  description: 'Encode PCM from Audio Decode into an AAC media selection for MP4 muxing.',
  inputs: {
    pcm: { type: 'pcm_audio', label: 'PCM Audio Clip' },
    selection: { type: 'media_selection', label: 'Source Selection' },
  },
  outputs: {
    selection: { type: 'media_selection', label: 'AAC Media Selection' },
  },
  params: {
    bitrate: {
      name: 'bitrate',
      type: 'number',
      default: 128_000,
      min: 32_000,
      step: 1_000,
    },
  },
  worker: 'decoder',
  async execute(ctx, { inputs, params }) {
    const pcm = inputs.pcm as PcmAudioClip | undefined;
    const sourceSelection = inputs.selection as MediaSelection | undefined;
    if (!pcm) throw new Error('AacEncoder: PCM clip is required');
    if (!sourceSelection) {
      throw new Error(
        'AacEncoder: connect the selection output from Audio Decode (same branch as PCM)',
      );
    }
    if (!isWebCodecsAacEncoderAvailable()) {
      throw new Error('AacEncoder: WebCodecs AudioEncoder is not available');
    }

    const encoded = await encodePcmToAac(pcm, {
      bitrate: Number(params.bitrate) || 128_000,
      signal: ctx.signal,
    });
    const aacSelection = buildAacMediaSelection(sourceSelection, encoded);

    ctx.log.info(
      `AacEncoder: ${encoded.packets.length} AAC packet(s), ${encoded.codecConfig.byteLength} byte ASC`,
    );
    return { selection: aacSelection };
  },
};
