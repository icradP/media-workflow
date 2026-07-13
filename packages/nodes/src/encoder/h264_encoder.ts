import type { DecodedVideoClip, MediaSelection, NodeDefinition } from '@media-workflow/core';
import {
  buildH264MediaSelection,
  encodeDecodedVideoToH264,
  isWebCodecsH264EncoderAvailable,
} from '@media-workflow/codec';

export const h264EncoderNode: NodeDefinition<
  { video: 'decoded_video'; selection: 'media_selection' },
  { selection: 'media_selection' }
> = {
  id: 'h264_encoder',
  category: 'transform',
  displayName: 'H.264 Encoder',
  description: 'Encode captured or decoded video frames into an H.264 media selection for MP4 muxing.',
  inputs: {
    video: { type: 'decoded_video', label: 'Decoded Video Clip' },
    selection: { type: 'media_selection', label: 'Source Selection' },
  },
  outputs: {
    selection: { type: 'media_selection', label: 'H.264 Media Selection' },
  },
  params: {
    bitrate: {
      name: 'bitrate',
      type: 'number',
      default: 2_000_000,
      min: 250_000,
      step: 50_000,
    },
  },
  worker: 'decoder',
  async execute(ctx, { inputs, params }) {
    const video = inputs.video as DecodedVideoClip | undefined;
    const sourceSelection = inputs.selection as MediaSelection | undefined;
    if (!video) throw new Error('H264Encoder: decoded video clip is required');
    if (!sourceSelection) {
      throw new Error(
        'H264Encoder: connect the selection output from Device Capture (same branch as video)',
      );
    }
    if (!isWebCodecsH264EncoderAvailable()) {
      throw new Error('H264Encoder: WebCodecs VideoEncoder is not available');
    }

    const encoded = await encodeDecodedVideoToH264(video, {
      bitrate: Number(params.bitrate) || 2_000_000,
      signal: ctx.signal,
    });
    const selection = buildH264MediaSelection(sourceSelection, encoded);

    ctx.log.info(
      `H264Encoder: ${encoded.packets.length} H.264 packet(s), ${encoded.codecConfig.byteLength} byte avcC`,
    );
    return { selection };
  },
};
