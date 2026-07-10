import type { NodeDefinition } from '@media-workflow/core';

/**
 * UrlFetcher — 从 URL 拉取原始字节。
 *
 * Inputs:  (none)
 * Params:  url — 拉取地址
 * Outputs: buffer
 */
export const urlFetcherNode: NodeDefinition<
  Record<string, never>,
  { source: 'media_source' }
> = {
  id: 'url_fetcher',
  category: 'source',
  displayName: 'URL Fetcher',
  description: 'Fetch raw bytes from a URL.',
  inputs: {},
  outputs: {
    source: { type: 'media_source', label: 'Media Source' },
  },
  params: {
    url: { name: 'url', type: 'string', default: '' },
  },
  async execute(ctx, { params }) {
    const url = params.url as string;
    if (!url) throw new Error('URL Fetcher: url param is required');

    const response = await fetch(url, { signal: ctx.signal });
    if (!response.ok) throw new Error(`URL Fetcher: HTTP ${response.status}`);
    const arrayBuffer = await response.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);
    const version = `${response.headers.get('etag') ?? ''}:${data.byteLength}`;
    return {
      source: {
        sourceId: `url:${url}`,
        version,
        kind: 'url',
        name: new URL(url).pathname.split('/').pop() || url,
        mimeType: response.headers.get('content-type') ?? undefined,
        size: data.byteLength,
        data,
        metadata: {
          url,
          lastModified: response.headers.get('last-modified'),
        },
      },
    };
  },
};
