import type {
  DecodedVideoPixelFormat,
  DecodedVideoFrame,
  DecodedVideoFrameSet,
  NodeDefinition,
  VideoDecodeRequest,
} from '@media-workflow/core';
import {
  DECODE_LIMITS,
  DEFAULT_VIDEO_OUTPUT_FORMAT,
  WEBCODECS_H264_BACKEND,
} from '@media-workflow/core/decoder';
import {
  adaptPacketForDecoder,
  copyVideoFrame,
  isWebCodecsAvailable,
  resolveVideoFrameSampleId,
} from '@media-workflow/codec';

const SUPPORTED_OUTPUT_FORMATS = WEBCODECS_H264_BACKEND.outputFormats.filter(
  (format): format is DecodedVideoPixelFormat => format !== 'f32-planar',
);

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
  params: {
    outputFormat: {
      name: 'outputFormat',
      type: 'enum',
      default: DEFAULT_VIDEO_OUTPUT_FORMAT,
      values: [...SUPPORTED_OUTPUT_FORMATS],
    },
  },
  worker: 'decoder',
  async execute(ctx, { inputs, params }) {
    const request = inputs.request as VideoDecodeRequest | undefined;
    if (!request) throw new Error('WebCodecsVideoDecoder: request is required');
    const outputFormat = String(params.outputFormat ?? DEFAULT_VIDEO_OUTPUT_FORMAT) as DecodedVideoPixelFormat;
    if (!SUPPORTED_OUTPUT_FORMATS.includes(outputFormat)) {
      throw new Error(
        `WebCodecsVideoDecoder: output format ${outputFormat} is not supported by ${WEBCODECS_H264_BACKEND.id}`,
      );
    }
    if (!isWebCodecsAvailable()) {
      throw new Error('WebCodecsVideoDecoder: WebCodecs is not available in this environment');
    }

    let decodePackets = request.decodePackets;
    let targetSampleIds = request.targetSampleIds;
    const diagnostics = [...request.diagnostics];
    if (decodePackets.length > DECODE_LIMITS.maxVideoFrames) {
      const kept = DECODE_LIMITS.maxVideoFrames;
      decodePackets = decodePackets.slice(0, kept);
      const keepIds = new Set(decodePackets.map(packet => packet.sourceSampleId));
      targetSampleIds = targetSampleIds.filter(id => keepIds.has(id));
      diagnostics.push({
        severity: 'warning',
        code: 'decoder.webcodecs.video_truncated',
        message:
          `Decode truncated from ${request.decodePackets.length} to ${kept} packets `
          + `(DECODE_LIMITS.maxVideoFrames). Lower resolution/fps or shorten the range for longer Live play.`,
      });
      ctx.log.warn(diagnostics[diagnostics.length - 1]!.message);
    }

    const targetIds = new Set(targetSampleIds);
    const ptsToSampleId = new Map(
      decodePackets.map(packet => [packet.ptsUs, packet.sourceSampleId]),
    );
    const pendingFrames: Array<{ frame: VideoFrame; sourceSampleId: string }> = [];
    const decoder = new VideoDecoder({
      output: frame => {
        const sourceSampleId = resolveVideoFrameSampleId(
          frame.timestamp,
          ptsToSampleId,
          targetIds,
        );
        if (sourceSampleId) {
          pendingFrames.push({ frame: frame.clone(), sourceSampleId });
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

    for (const packet of decodePackets) {
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

    const decodedFrames: DecodedVideoFrame[] = [];
    for (const pending of pendingFrames) {
      try {
        decodedFrames.push(await copyVideoFrame(pending.frame, pending.sourceSampleId, outputFormat));
      } finally {
        pending.frame.close();
      }
    }

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
