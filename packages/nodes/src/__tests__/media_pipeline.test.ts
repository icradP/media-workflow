import { describe, expect, it } from 'vitest';
import {
  createMemoryCache,
  executeGraph,
  type NodeDefinition,
  type WorkflowGraph,
} from '@media-workflow/core';
import { autoAnalyzeNode } from '../parser/auto_detect.js';
import { streamOverviewNode } from '../display/stream_info.js';
import { trackSelectNode } from '../select/track_select.js';
import { trackDetailNode } from '../display/track_detail.js';

const wavBytes = createWavHeader({ sampleRate: 48_000, channels: 2, bitsPerSample: 16 });

const fileSourceNode: NodeDefinition<Record<string, never>, { source: 'media_source' }> = {
  id: 'test_file_loader',
  category: 'source',
  displayName: 'Test File Loader',
  inputs: {},
  outputs: {
    source: { type: 'media_source', label: 'Media Source' },
  },
  async execute() {
    return {
      source: {
        sourceId: 'test:wav',
        version: '1',
        kind: 'memory',
        name: 'test.wav',
        mimeType: 'audio/wav',
        size: wavBytes.byteLength,
        data: wavBytes,
        metadata: {},
      },
    };
  },
};

describe('media workflow pipeline', () => {
  it('passes file bytes through auto detection into stream info', async () => {
    const graph: WorkflowGraph = {
      version: 1,
      nodes: new Map<string, NodeDefinition>([
        ['file', fileSourceNode as NodeDefinition],
        ['detect', autoAnalyzeNode as NodeDefinition],
        ['stream', streamOverviewNode as NodeDefinition],
        ['selector', trackSelectNode as NodeDefinition],
        ['detail', trackDetailNode as NodeDefinition],
      ]),
      edges: [
        {
          id: 'file-to-detect',
          sourceNodeId: 'file',
          sourceOutput: 'source',
          targetNodeId: 'detect',
          targetInput: 'source',
        },
        {
          id: 'detect-to-stream',
          sourceNodeId: 'detect',
          sourceOutput: 'asset',
          targetNodeId: 'stream',
          targetInput: 'asset',
        },
        {
          id: 'detect-to-selector',
          sourceNodeId: 'detect',
          sourceOutput: 'asset',
          targetNodeId: 'selector',
          targetInput: 'asset',
        },
        {
          id: 'selector-to-detail',
          sourceNodeId: 'selector',
          sourceOutput: 'selectedTrack',
          targetNodeId: 'detail',
          targetInput: 'selectedTrack',
        },
      ],
    };

    const results = await executeGraph(
      graph,
      createMemoryCache(),
      new AbortController().signal,
    );

    const asset = results.get('detect')?.get('asset');
    const tracks = results.get('stream')?.get('tracks');
    const selectedTrack = results.get('selector')?.get('selectedTrack') as {
      track: unknown;
    };

    expect(asset).toMatchObject({
      container: { format: 'wav' },
      tracks: [{ kind: 'audio', codec: 'PCM', codecFamily: 'pcm' }],
    });
    expect(tracks).toMatchObject([
      { kind: 'audio', codec: 'PCM', sampleRate: 48_000, channels: 2 },
    ]);
    expect(selectedTrack.track).toMatchObject({
      kind: 'audio',
      codec: 'PCM',
      sampleRate: 48_000,
      channels: 2,
    });
    expect(results.has('detail')).toBe(true);
  });
});

function createWavHeader(options: {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
}): Uint8Array {
  const bytes = new Uint8Array(44);
  const view = new DataView(bytes.buffer);
  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index++) {
      bytes[offset + index] = value.charCodeAt(index);
    }
  };

  const bytesPerSample = options.bitsPerSample / 8;
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, options.channels, true);
  view.setUint32(24, options.sampleRate, true);
  view.setUint32(28, options.sampleRate * options.channels * bytesPerSample, true);
  view.setUint16(32, options.channels * bytesPerSample, true);
  view.setUint16(34, options.bitsPerSample, true);
  writeAscii(36, 'data');
  view.setUint32(40, 0, true);
  return bytes;
}
