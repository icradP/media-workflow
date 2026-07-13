import type { MediaFile, NodeDefinition } from '@media-workflow/core';

export const fileExportNode: NodeDefinition<
  { file: 'media_file' },
  { download: 'string' }
> = {
  id: 'file_export',
  category: 'export',
  displayName: 'File Export',
  description: 'Prepare a media file for browser download.',
  inputs: {
    file: { type: 'media_file', label: 'Media File' },
  },
  outputs: {
    download: { type: 'string', label: 'Download Payload' },
  },
  async execute(ctx, { inputs }) {
    const file = inputs.file as MediaFile | undefined;
    if (!file) throw new Error('FileExport: media file is required');

    ctx.log.info(`FileExport: ${file.fileName} (${file.data.byteLength} bytes)`);
    return {
      download: JSON.stringify({
        fileName: file.fileName,
        mimeType: file.mimeType,
        extension: file.extension,
        byteLength: file.data.byteLength,
        metadata: file.metadata,
      }),
    };
  },
};
