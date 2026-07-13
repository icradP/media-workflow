import type {
  AudioMediaTrack,
  MediaAsset,
  MediaSelection,
  NodeDefinition,
} from '@media-workflow/core';
import {
  materializeMediaSelection,
  planAudioDecodeRequest,
  selectTrack,
} from '@media-workflow/codec';
import { g711DecoderNode } from '../decoder/g711.js';
import { webcodecsAudioDecoderNode } from '../decoder/webcodecs_audio.js';

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

    const selectedTrack = isMediaSelection(source)
      ? source.selectedTrack
      : selectTrack(source, {
        trackId: String(params.trackId ?? ''),
        kind: 'audio',
        index: Number(params.trackIndex),
      });
    const selection = materializeMediaSelection(selectedTrack, {
      startTimeUs: secondsToUs(params.startTimeSeconds),
      endTimeUs: secondsToOptionalUs(params.endTimeSeconds),
      frameType: 'all',
      order: 'presentation',
    });

    const { asset, track } = selection.selectedTrack;
    if (track.kind !== 'audio') {
      throw new Error(`AudioDecode: selection track ${track.trackId} is not audio`);
    }
    if (!track.decoderConfig) {
      throw new Error(`AudioDecode: track ${track.trackId} has no decoder configuration`);
    }

    const rangeEndUs = selection.rangeEndUs ??
      selection.samples.at(-1)?.ptsUs ??
      selection.rangeStartUs;
    const request = planAudioDecodeRequest({
      requestId: `${selection.selectionId}:audio`,
      track: track as AudioMediaTrack,
      decoderConfig: track.decoderConfig,
      samples: asset.samples,
      rangeStartUs: selection.rangeStartUs,
      rangeEndUs,
      containerFormat: asset.container.format,
    });

    const decoder = track.codecFamily === 'g711'
      ? g711DecoderNode
      : webcodecsAudioDecoderNode;
    const result = await decoder.execute(ctx, {
      inputs: { request },
      params: {},
    });
    return {
      audio: { ...result.pcm, selectionId: selection.selectionId },
      selection,
    };
  },
};

function isMediaSelection(value: MediaAsset | MediaSelection): value is MediaSelection {
  return 'selectionId' in value && 'selectedTrack' in value;
}

function secondsToUs(value: unknown): number {
  return Math.max(0, Number(value) || 0) * 1_000_000;
}

function secondsToOptionalUs(value: unknown): number | undefined {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000_000 : undefined;
}
