import type {
  DecodedVideoPixelFormat,
  MediaAsset,
  MediaSelection,
  NodeDefinition,
  VideoMediaTrack,
} from '@media-workflow/core';
import {
  DEFAULT_VIDEO_OUTPUT_FORMAT,
  WEBCODECS_H264_BACKEND,
} from '@media-workflow/core/decoder';
import {
  materializeMediaSelection,
  planVideoDecodeRequest,
  selectTrack,
} from '@media-workflow/codec';
import { webcodecsVideoDecoderNode } from '../decoder/webcodecs_video.js';

const OUTPUT_FORMATS = WEBCODECS_H264_BACKEND.outputFormats.filter(
  (format): format is DecodedVideoPixelFormat => format !== 'f32-planar',
);

export const videoDecodeNode: NodeDefinition<
  { source: 'decode_source' },
  { video: 'decoded_video'; selection: 'media_selection' }
> = {
  id: 'video_decode',
  category: 'decode',
  displayName: 'Video Decode',
  description: 'Decode a prepared selection or select and decode directly from an asset.',
  inputs: {
    source: { type: 'decode_source', label: 'Asset or Media Selection' },
  },
  outputs: {
    video: { type: 'decoded_video', label: 'Decoded Video' },
    selection: { type: 'media_selection', label: 'Media Selection' },
  },
  params: {
    trackId: { name: 'trackId', type: 'string', default: '' },
    trackIndex: { name: 'trackIndex', type: 'number', default: 0, min: 0, step: 1 },
    startIndex: { name: 'startIndex', type: 'number', default: 0, min: 0, step: 1 },
    endIndex: { name: 'endIndex', type: 'number', default: -1, min: -1, step: 1 },
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
    frameType: {
      name: 'frameType',
      type: 'enum',
      default: 'key',
      values: ['all', 'key', 'non_key', 'I', 'P', 'B', 'IDR'],
    },
    limit: { name: 'limit', type: 'number', default: 1, min: -1, step: 1 },
    outputFormat: {
      name: 'outputFormat',
      type: 'enum',
      default: DEFAULT_VIDEO_OUTPUT_FORMAT,
      values: [...OUTPUT_FORMATS],
    },
  },
  worker: 'decoder',
  async execute(ctx, { inputs, params }) {
    const source = inputs.source as MediaAsset | MediaSelection | undefined;
    if (!source) throw new Error('VideoDecode: asset or media selection is required');

    const selectedTrack = isMediaSelection(source)
      ? source.selectedTrack
      : selectTrack(source, {
        trackId: String(params.trackId ?? ''),
        kind: 'video',
        index: Number(params.trackIndex),
      });
    const selection = materializeMediaSelection(selectedTrack, {
      startIndex: Number(params.startIndex),
      endIndex: optionalUpperBound(params.endIndex),
      startTimeUs: secondsToUs(params.startTimeSeconds),
      endTimeUs: secondsToOptionalUs(params.endTimeSeconds),
      frameType: String(params.frameType) as never,
      limit: optionalUpperBound(params.limit),
      order: 'presentation',
    });

    const { asset, track } = selection.selectedTrack;
    if (track.kind !== 'video') {
      throw new Error(`VideoDecode: selection track ${track.trackId} is not video`);
    }
    if (!track.decoderConfig) {
      throw new Error(`VideoDecode: track ${track.trackId} has no decoder configuration`);
    }

    const request = planVideoDecodeRequest({
      requestId: `${selection.selectionId}:video`,
      track: track as VideoMediaTrack,
      decoderConfig: track.decoderConfig,
      samples: asset.samples,
      selection: {
        sampleIds: selection.samples.map(sample => sample.sampleId),
      },
      containerFormat: asset.container.format,
    });

    const result = await webcodecsVideoDecoderNode.execute(ctx, {
      inputs: { request },
      params: { outputFormat: params.outputFormat },
    });
    return {
      video: { ...result.frames, selectionId: selection.selectionId },
      selection,
    };
  },
};

function isMediaSelection(value: MediaAsset | MediaSelection): value is MediaSelection {
  return 'selectionId' in value && 'selectedTrack' in value;
}

function optionalUpperBound(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : undefined;
}

function secondsToUs(value: unknown): number {
  return Math.max(0, Number(value) || 0) * 1_000_000;
}

function secondsToOptionalUs(value: unknown): number | undefined {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000_000 : undefined;
}
