import type {
  MediaAsset,
  MediaSelection,
  NodeDefinition,
} from '@media-workflow/core';
import {
  decodeAudioSelectionToPcm,
  resolveAudioSelection,
} from '@media-workflow/codec';
import { decodeAudioRequestToPcm } from '../decoder/decode_audio_request.js';

export const audioDecodeNode: NodeDefinition<
  { source: 'decode_source' },
  { audio: 'pcm_audio'; selection: 'media_selection' }
> = {
  id: 'audio_decode',
  category: 'decode',
  displayName: 'Audio Decode',
  description: 'Decode a prepared audio selection using the appropriate backend.',
  inputs: {
    source: { type: 'decode_source', label: 'Asset or Media Selection' },
  },
  outputs: {
    audio: { type: 'pcm_audio', label: 'Decoded Audio' },
    selection: { type: 'media_selection', label: 'Media Selection' },
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
  },
  worker: 'decoder',
  async execute(ctx, { inputs, params }) {
    const source = inputs.source as MediaAsset | MediaSelection | undefined;
    if (!source) throw new Error('AudioDecode: asset or media selection is required');

    const selection = resolveAudioSelection(source, params);
    const pcm = await decodeAudioSelectionToPcm(
      selection,
      `${selection.selectionId}:audio`,
      async request => decodeAudioRequestToPcm(ctx, request),
    );

    return {
      audio: { ...pcm, selectionId: selection.selectionId },
      selection,
    };
  },
};
