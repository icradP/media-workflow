import type {
  MediaAsset,
  MediaSelection,
  NodeDefinition,
} from '@media-workflow/core';
import {
  buildAacMediaSelection,
  decodeAudioSelectionToPcm,
  encodePcmToAac,
  isWebCodecsAacEncoderAvailable,
  resolveAudioSelection,
} from '@media-workflow/codec';
import { decodeAudioRequestToPcm } from '../decoder/decode_audio_request.js';

export const aacTranscodeNode: NodeDefinition<
  { source: 'decode_source' },
  { selection: 'media_selection' }
> = {
  id: 'aac_transcode',
  category: 'transform',
  displayName: 'AAC Transcode',
  description: 'One-step MP3/AAC/G.711 → AAC transcode (shortcut for Audio Decode + AAC Encoder).',
  inputs: {
    source: { type: 'decode_source', label: 'Asset or Media Selection' },
  },
  outputs: {
    selection: { type: 'media_selection', label: 'AAC Media Selection' },
  },
  params: {
    trackId: { name: 'trackId', type: 'string', default: '' },
    trackIndex: { name: 'trackIndex', type: 'number', default: 0, min: 0, step: 1 },
    startTimeSeconds: {
      name: 'startTimeSeconds',
      type: 'number',
      default: 0,
      min: 0,
      step: 0.001,
    },
    endTimeSeconds: {
      name: 'endTimeSeconds',
      type: 'number',
      default: -1,
      min: -1,
      step: 0.001,
    },
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
    const source = inputs.source as MediaAsset | MediaSelection | undefined;
    if (!source) throw new Error('AacTranscode: asset or media selection is required');
    if (!isWebCodecsAacEncoderAvailable()) {
      throw new Error('AacTranscode: WebCodecs AudioEncoder is not available');
    }

    const selection = resolveAudioSelection(source, params);
    const pcm = await decodeAudioSelectionToPcm(
      selection,
      `${selection.selectionId}:transcode`,
      async request => decodeAudioRequestToPcm(ctx, request),
    );

    const encoded = await encodePcmToAac(pcm, {
      bitrate: Number(params.bitrate) || 128_000,
      signal: ctx.signal,
    });
    const aacSelection = buildAacMediaSelection(selection, encoded);

    ctx.log.info(
      `AacTranscode: ${encoded.packets.length} AAC packet(s), ${encoded.codecConfig.byteLength} byte ASC`,
    );
    return { selection: aacSelection };
  },
};
