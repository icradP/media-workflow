import type { NodeDefinition } from '@media-workflow/core';
import type { MediaSource } from '@media-workflow/core';
import { toHex } from '@media-workflow/codec';

/**
 * HexView — 以十六进制表格形式显示原始字节。
 *
 * Inputs:  data (buffer)
 * Outputs: preview (供 UI viewport 渲染)
 */
export const hexViewNode: NodeDefinition<
  { source: 'media_source' },
  { preview: 'string' }
> = {
  id: 'hex_view',
  category: 'display',
  displayName: 'Hex View',
  description: 'Display raw bytes in hexadecimal format with offset/ASCII columns.',
  inputs: {
    source: { type: 'media_source', label: 'Media Source' },
  },
  outputs: {
    preview: { type: 'string', label: 'Hex Preview' },
  },
  async execute(ctx, { inputs }) {
    const source = inputs.source as MediaSource | undefined;
    if (!source) throw new Error('HexView: no media source');

    const slice = source.data.subarray(0, Math.min(source.size, 256));
    const hex = toHex(slice);
    ctx.log.info(`HexView: ${slice.byteLength} bytes`);
    return {
      preview: JSON.stringify({ offset: 0, hex, ascii: toAscii(slice) }),
    };
  },
};

function toAscii(bytes: Uint8Array): string {
  return Array.from(bytes, b => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
}
