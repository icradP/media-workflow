import type {
  MediaAsset,
  MediaTrack,
  NodeDefinition,
  VideoDecodeRequest,
  VideoMediaTrack,
} from '@media-workflow/core';
import { planVideoDecodeRequest } from '@media-workflow/codec';

export const videoFrameRequestNode: NodeDefinition<
  { asset: 'media_asset'; track: 'media_track' },
  { request: 'video_decode_request' }
> = {
  id: 'video_frame_request',
  category: 'utility',
  displayName: 'Video Frame Request',
  description: 'Plan GOP decode dependencies for selected video frames.',
  inputs: {
    asset: { type: 'media_asset', label: 'Media Asset' },
    track: { type: 'media_track', label: 'Video Track' },
  },
  outputs: {
    request: { type: 'video_decode_request', label: 'Video Decode Request' },
  },
  params: {
    startIndex: { name: 'startIndex', type: 'number', default: 0, min: 0, step: 1 },
    endIndex: { name: 'endIndex', type: 'number', default: -1, min: -1, step: 1 },
    startTimeSeconds: {
      name: 'startTimeSeconds',
      type: 'number',
      default: 0,
      min: 0,
      step: 0.1,
    },
    endTimeSeconds: {
      name: 'endTimeSeconds',
      type: 'number',
      default: -1,
      min: -1,
      step: 0.1,
    },
    frameType: {
      name: 'frameType',
      type: 'enum',
      default: 'all',
      values: ['all', 'key'],
    },
    limit: { name: 'limit', type: 'number', default: 1, min: -1, step: 1 },
    outputFormat: {
      name: 'outputFormat',
      type: 'enum',
      default: 'I420',
      values: ['I420', 'NV12', 'RGBA8', 'BGRA8'],
    },
  },
  worker: 'decoder',
  async execute(ctx, { inputs, params }) {
    const asset = inputs.asset as MediaAsset | undefined;
    const track = inputs.track as MediaTrack | undefined;
    if (!asset) throw new Error('VideoFrameRequest: media asset is required');
    if (!track || track.kind !== 'video') {
      throw new Error('VideoFrameRequest: a video track is required');
    }
    if (!track.decoderConfig) {
      throw new Error(`VideoFrameRequest: track ${track.trackId} has no decoder configuration`);
    }

    const endTimeSeconds = Number(params.endTimeSeconds);
    const limit = Number(params.limit);
    const endIndexParam = optionalUpperBound(params.endIndex);
    const request = planVideoDecodeRequest({
      requestId: `${track.trackId}:${Date.now()}`,
      track: track as VideoMediaTrack,
      decoderConfig: track.decoderConfig,
      samples: asset.samples,
      containerFormat: asset.container.format,
      outputFormat: String(params.outputFormat ?? 'I420') as VideoDecodeRequest['outputFormat'],
      selection: {
        startIndex: Math.max(0, Math.floor(Number(params.startIndex) || 0)),
        endIndex: endIndexParam,
        startTimeUs: Math.max(0, Number(params.startTimeSeconds) || 0) * 1_000_000,
        endTimeUs: Number.isFinite(endTimeSeconds) && endTimeSeconds >= 0
          ? endTimeSeconds * 1_000_000
          : undefined,
        frameType: String(params.frameType) === 'key' ? 'key' : 'all',
        limit: Number.isFinite(limit) && limit >= 0 ? Math.floor(limit) : undefined,
      },
    });

    ctx.log.info(
      `VideoFrameRequest: ${request.targetSampleIds.length} target(s), ${request.decodePackets.length} decode packet(s)`,
    );
    return { request };
  },
};

function optionalUpperBound(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : undefined;
}
