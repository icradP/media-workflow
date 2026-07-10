import type { NodeDefinition } from '@media-workflow/core';
import type { MediaSource } from '@media-workflow/core';

/**
 * FileLoader — 从浏览器 File/Blob 读取原始字节。
 *
 * Inputs:  (none — 由 UI 侧提供 File 对象)
 * Outputs: buffer
 */
export const fileLoaderNode: NodeDefinition<
  Record<string, never>,
  { source: 'media_source' }
> = {
  id: 'file_loader',
  category: 'source',
  displayName: 'File Loader',
  description: 'Load a file from the local filesystem via browser File API.',
  inputs: {},
  outputs: {
    source: { type: 'media_source', label: 'Media Source' },
  },
  /**
   * execute 在浏览器环境中由 UI 层注入 File 引用。
   * 在 Worker 环境中通过 Transferable 接收 ArrayBuffer。
   */
  async execute(ctx, { inputs }) {
    // 此 node 的实际执行由 UI 侧适配——先选择文件后注入 buffer
    // 这里提供默认实现：期望 UI 层在调用前将 File 放入 ctx 扩展字段
    const file = (ctx as unknown as Record<string, unknown>).__file as File | undefined;
    if (!file) {
      throw new Error('FileLoader: no file provided. UI must inject a File object via ctx.__file');
    }
    return { source: await mediaSourceFromFile(file) };
  },
};

export async function mediaSourceFromFile(file: File): Promise<MediaSource> {
  const data = new Uint8Array(await file.arrayBuffer());
  const version = `${file.lastModified}:${file.size}`;
  return {
    sourceId: `file:${file.name}:${version}`,
    version,
    kind: 'file',
    name: file.name,
    mimeType: file.type || undefined,
    size: data.byteLength,
    data,
    metadata: {
      lastModified: file.lastModified,
    },
  };
}
