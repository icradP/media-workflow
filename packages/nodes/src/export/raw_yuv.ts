import type { DecodedVideoFrame, MediaFile, NodeDefinition } from '@media-workflow/core';
import { packI420Planes } from '@media-workflow/codec';

export const rawYuvExporterNode: NodeDefinition<
  { frame: 'video_frame' },
  { file: 'media_file' }
> = {
  id: 'raw_yuv_exporter',
  category: 'export',
  displayName: 'Raw YUV Exporter',
  description: 'Export a decoded frame as raw .yuv bytes.',
  inputs: {
    frame: { type: 'video_frame', label: 'Decoded Frame' },
  },
  outputs: {
    file: { type: 'media_file', label: 'YUV File' },
  },
  params: {
    fileName: { name: 'fileName', type: 'string', default: 'frame.yuv' },
  },
  async execute(ctx, { inputs, params }) {
    const frame = inputs.frame as DecodedVideoFrame | undefined;
    if (!frame) throw new Error('RawYuvExporter: decoded frame is required');

    const data = packI420Planes(frame);
    const fileName = String(params.fileName || 'frame.yuv');
    ctx.log.info(`RawYuvExporter: ${data.byteLength} bytes`);
    return {
      file: {
        fileName,
        mimeType: 'application/octet-stream',
        extension: 'yuv',
        data,
        metadata: {
          format: frame.format,
          width: frame.displayWidth,
          height: frame.displayHeight,
          ptsUs: frame.ptsUs,
          sourceSampleId: frame.sourceSampleId,
        },
      },
    };
  },
};
