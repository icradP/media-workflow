import type {
  AudioDecodeRequest,
  AudioMediaTrack,
  MediaAsset,
  MediaTrack,
  NodeDefinition,
} from '@media-workflow/core';
import { planAudioDecodeRequest } from '@media-workflow/codec';

export const audioRangeRequestNode: NodeDefinition<
  { asset: 'media_asset'; track: 'media_track' },
  { request: 'audio_decode_request' }
> = {
  id: 'audio_range_request',
  category: 'utility',
  displayName: 'Audio Range Request',
  description: 'Select overlapping audio packets for a microsecond time range.',
  inputs: {
    asset: { type: 'media_asset', label: 'Media Asset' },
    track: { type: 'media_track', label: 'Audio Track' },
  },
  outputs: {
    request: { type: 'audio_decode_request', label: 'Audio Decode Request' },
  },
  params: {
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
      default: 5,
      min: 0,
      step: 0.1,
    },
  },
  worker: 'decoder',
  async execute(ctx, { inputs, params }) {
    const asset = inputs.asset as MediaAsset | undefined;
    const track = inputs.track as MediaTrack | undefined;
    if (!asset) throw new Error('AudioRangeRequest: media asset is required');
    if (!track || track.kind !== 'audio') {
      throw new Error('AudioRangeRequest: an audio track is required');
    }
    if (!track.decoderConfig) {
      throw new Error(`AudioRangeRequest: track ${track.trackId} has no decoder configuration`);
    }

    const trackSamples = asset.samples
      .filter(sample => sample.trackId === track.trackId)
      .sort((left, right) => left.ptsUs - right.ptsUs || left.index - right.index);
    const firstPtsUs = trackSamples[0]?.ptsUs ?? 0;
    const startTimeUs = firstPtsUs + Math.max(0, Number(params.startTimeSeconds) || 0) * 1_000_000;
    const endTimeUs = firstPtsUs + Math.max(0, Number(params.endTimeSeconds) || 0) * 1_000_000;

    const request = planAudioDecodeRequest({
      requestId: `${track.trackId}:${Date.now()}`,
      track: track as AudioMediaTrack,
      decoderConfig: track.decoderConfig,
      samples: asset.samples,
      rangeStartUs: startTimeUs,
      rangeEndUs: endTimeUs,
      containerFormat: asset.container.format,
    });

    ctx.log.info(
      `AudioRangeRequest: ${request.decodePackets.length} packet(s) for [${request.rangeStartUs}, ${request.rangeEndUs})`,
    );
    return { request };
  },
};
