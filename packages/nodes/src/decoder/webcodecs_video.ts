import type {
  DecodedVideoFrame,
  DecodedVideoFrameSet,
  NodeDefinition,
  VideoDecodeRequest,
} from '@media-workflow/core';
import {
  DECODE_LIMITS,
  WEBCODECS_H264_BACKEND,
} from '@media-workflow/core/decoder';
import {
  adaptPacketForDecoder,
  copyVideoFrameToI420,
  isWebCodecsAvailable,
} from '@media-workflow/codec';

export const webcodecsVideoDecoderNode: NodeDefinition<
  { request: 'video_decode_request' },
  { frames: 'decoded_video_frames' }
> = {
  id: 'webcodecs_video_decoder',
  category: 'decoder',
  displayName: 'WebCodecs Video Decoder',
  description: 'Decode H.264 GOP requests using the browser WebCodecs API.',
  inputs: {
    request: { type: 'video_decode_request', label: 'Video Decode Request' },
  },
  outputs: {
    frames: { type: 'decoded_video_frames', label: 'Decoded Frames' },
  },
  worker: 'decoder',
  async execute(ctx, { inputs }) {
    const request = inputs.request as VideoDecodeRequest | undefined;
    if (!request) throw new Error('WebCodecsVideoDecoder: request is required');
    if (!isWebCodecsAvailable()) {
      throw new Error('WebCodecsVideoDecoder: WebCodecs is not available in this environment');
    }
    if (request.decodePackets.length > DECODE_LIMITS.maxVideoFrames) {
      throw new Error(
        `WebCodecsVideoDecoder: decode packet count ${request.decodePackets.length} exceeds limit ${DECODE_LIMITS.maxVideoFrames}`,
      );
    }

    const diagnostics = [...request.diagnostics];
    const targetIds = new Set(request.targetSampleIds);
    const ptsToSampleId = new Map(
      request.decodePackets.map(packet => [packet.ptsUs, packet.sourceSampleId]),
    );
    const decodedFrames: DecodedVideoFrame[] = [];
    const decoder = new VideoDecoder({
      output: frame => {
        const sourceSampleId = ptsToSampleId.get(Math.round(frame.timestamp)) ?? '';
        if (targetIds.has(sourceSampleId)) {
          decodedFrames.push(copyVideoFrameToI420(frame, sourceSampleId));
        }
        frame.close();
      },
      error: error => {
        diagnostics.push({
          severity: 'error',
          code: 'decoder.webcodecs.video_error',
          message: error.message,
        });
      },
    });

    decoder.configure({
      codec: request.decoderConfig.codec,
      description: request.decoderConfig.description,
      codedWidth: request.decoderConfig.codedWidth,
      codedHeight: request.decoderConfig.codedHeight,
    });

    const inputFormat = request.decoderConfig.bitstreamFormat;
    const chunkFormat = inputFormat === 'annexb' ? 'annexb' : 'avcc';

    for (const packet of request.decodePackets) {
      if (ctx.signal.aborted) break;
      const payload = adaptPacketForDecoder(packet.data, packet.bitstreamFormat, chunkFormat);
      const chunk = new EncodedVideoChunk({
        type: packet.isKey ? 'key' : 'delta',
        timestamp: packet.ptsUs,
        duration: packet.durationUs,
        data: payload,
      });
      decoder.decode(chunk);
    }

    await decoder.flush();
    decoder.close();

    decodedFrames.sort((left, right) => left.ptsUs - right.ptsUs);
    ctx.log.info(`WebCodecsVideoDecoder: ${decodedFrames.length} target frame(s)`);

    return {
      frames: {
        requestId: request.requestId,
        backend: WEBCODECS_H264_BACKEND,
        frames: decodedFrames,
        diagnostics,
      },
    };
  },
};
