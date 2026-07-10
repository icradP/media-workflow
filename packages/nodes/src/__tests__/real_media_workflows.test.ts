import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  createMemoryCache,
  executeGraph,
  type CodecFamily,
  type MediaSource,
  type MediaTrack,
  type NodeDefinition,
  type NodeExecutionEvent,
  type WorkflowGraph,
} from '@media-workflow/core';
import { fileLoaderNode } from '../source/file_loader.js';
import { autoAnalyzeNode } from '../parser/auto_detect.js';
import { streamOverviewNode } from '../display/stream_info.js';
import { trackSelectorNode } from '../utility/track_selector.js';
import { frameSelectorNode } from '../utility/frame_selector.js';
import { trackDetailNode } from '../display/track_detail.js';
import { frameTableNode } from '../display/frame_table.js';
import { hexViewNode } from '../display/hex_view.js';

interface BaselineStream {
  index: number;
  kind: 'audio' | 'video' | 'data';
  codec: string;
  frameCount: number | null;
  sampleRate: number | null;
  channels: number | null;
  width: number | null;
  height: number | null;
}

interface BaselineRecord {
  input: {
    file: string;
    size: number;
    sha256: string;
  };
  expected: {
    streamCount: number;
    streams: BaselineStream[];
  };
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const baselineDir = join(root, 'tests', 'fixtures', 'ffprobe');
const records = readdirSync(baselineDir)
  .filter(fileName => fileName.endsWith('.ffprobe.json'))
  .sort()
  .map(fileName =>
    JSON.parse(readFileSync(join(baselineDir, fileName), 'utf8')) as BaselineRecord,
  );

describe('real media files through registered node combinations', () => {
  it.each(records)('$input.file', async record => {
    const bytes = new Uint8Array(readFileSync(join(root, record.input.file)));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const source: MediaSource = {
      sourceId: `fixture:${sha256}`,
      version: sha256,
      kind: 'file',
      name: record.input.file,
      size: bytes.byteLength,
      data: bytes,
      metadata: {},
    };
    const events: NodeExecutionEvent[] = [];
    const {
      graph,
      selectorNodeIds,
      detailNodeIds,
      frameSelectorNodeIds,
      filteredTableNodeIds,
    } = buildWorkflow(source, record);

    const results = await executeGraph(
      graph,
      createMemoryCache(),
      new AbortController().signal,
      event => events.push(event),
    );

    expect(sha256).toBe(record.input.sha256);
    expect(source.size).toBe(record.input.size);

    const asset = results.get('analyze')?.get('asset') as {
      tracks: MediaTrack[];
      samples: unknown[];
    };
    const overviewTracks = results.get('overview')?.get('tracks') as MediaTrack[];
    expect(asset.tracks).toHaveLength(record.expected.streamCount);
    expect(overviewTracks).toBe(asset.tracks);

    for (const [position, expected] of record.expected.streams.entries()) {
      const selected = results.get(selectorNodeIds[position]!)?.get('track') as MediaTrack;
      assertTrackMatchesBaseline(selected, expected);

      const detailEvent = events.find(event => event.nodeId === detailNodeIds[position]);
      expect(detailEvent?.inputs.track).toBe(selected);
      expect(detailEvent?.node.id).toBe('track_detail');

      const selectedFrames = results
        .get(frameSelectorNodeIds[position]!)
        ?.get('samples') as Array<{ trackId: string }>;
      expect(selectedFrames.every(sample => sample.trackId === selected.trackId)).toBe(true);
      expect(results.get(filteredTableNodeIds[position]!)?.get('samples')).toBe(selectedFrames);
    }

    const samples = results.get('frames')?.get('samples') as unknown[];
    expect(samples).toBe(asset.samples);

    const preview = results.get('hex')?.get('preview');
    expect(typeof preview).toBe('string');
    expect(JSON.parse(String(preview))).toMatchObject({ offset: 0 });

    const executedNodeTypes = new Set(events.map(event => event.node.id));
    expect(executedNodeTypes).toEqual(new Set([
      'file_loader',
      'auto_analyze',
      'stream_overview',
      'frame_table',
      'hex_view',
      ...(record.expected.streamCount > 0 ? ['track_selector', 'track_detail'] : []),
      ...(record.expected.streamCount > 0 ? ['frame_selector'] : []),
    ]));
  }, 30_000);
});

function buildWorkflow(
  source: MediaSource,
  record: BaselineRecord,
): {
  graph: WorkflowGraph;
  selectorNodeIds: string[];
  detailNodeIds: string[];
  frameSelectorNodeIds: string[];
  filteredTableNodeIds: string[];
} {
  const sourceNode: NodeDefinition = {
    ...fileLoaderNode,
    async execute() {
      return { source };
    },
  } as NodeDefinition;
  const nodes = new Map<string, NodeDefinition>([
    ['file', sourceNode],
    ['analyze', autoAnalyzeNode as NodeDefinition],
    ['overview', streamOverviewNode as NodeDefinition],
    ['frames', frameTableNode as NodeDefinition],
    ['hex', hexViewNode as NodeDefinition],
  ]);
  const edges: WorkflowGraph['edges'] = [
    edge('file-analyze', 'file', 'source', 'analyze', 'source'),
    edge('file-hex', 'file', 'source', 'hex', 'source'),
    edge('analyze-overview', 'analyze', 'asset', 'overview', 'asset'),
    edge('analyze-frames', 'analyze', 'asset', 'frames', 'asset'),
  ];
  const selectorNodeIds: string[] = [];
  const detailNodeIds: string[] = [];
  const frameSelectorNodeIds: string[] = [];
  const filteredTableNodeIds: string[] = [];
  const kindPositions = new Map<string, number>();

  for (const expected of record.expected.streams) {
    const kindPosition = kindPositions.get(expected.kind) ?? 0;
    kindPositions.set(expected.kind, kindPosition + 1);
    const selectorId = `selector-${expected.index}`;
    const detailId = `detail-${expected.index}`;
    const frameSelectorId = `frame-selector-${expected.index}`;
    const filteredTableId = `filtered-table-${expected.index}`;
    selectorNodeIds.push(selectorId);
    detailNodeIds.push(detailId);
    frameSelectorNodeIds.push(frameSelectorId);
    filteredTableNodeIds.push(filteredTableId);
    nodes.set(selectorId, configuredSelector(expected.kind, kindPosition));
    nodes.set(detailId, trackDetailNode as NodeDefinition);
    nodes.set(frameSelectorId, frameSelectorNode as NodeDefinition);
    nodes.set(filteredTableId, frameTableNode as NodeDefinition);
    edges.push(
      edge(`analyze-${selectorId}`, 'analyze', 'asset', selectorId, 'asset'),
      edge(`${selectorId}-${detailId}`, selectorId, 'track', detailId, 'track'),
      edge(`analyze-${frameSelectorId}`, 'analyze', 'asset', frameSelectorId, 'asset'),
      edge(`${selectorId}-${frameSelectorId}`, selectorId, 'track', frameSelectorId, 'track'),
      edge(
        `${frameSelectorId}-${filteredTableId}`,
        frameSelectorId,
        'samples',
        filteredTableId,
        'samples',
      ),
    );
  }

  return {
    graph: { version: 1, nodes, edges },
    selectorNodeIds,
    detailNodeIds,
    frameSelectorNodeIds,
    filteredTableNodeIds,
  };
}

function configuredSelector(kind: string, index: number): NodeDefinition {
  const params = trackSelectorNode.params!;
  return {
    ...trackSelectorNode,
    params: {
      ...params,
      kind: { ...params.kind!, default: kind },
      index: { ...params.index!, default: index },
    },
  } as NodeDefinition;
}

function edge(
  id: string,
  sourceNodeId: string,
  sourceOutput: string,
  targetNodeId: string,
  targetInput: string,
): WorkflowGraph['edges'][number] {
  return { id, sourceNodeId, sourceOutput, targetNodeId, targetInput };
}

function assertTrackMatchesBaseline(track: MediaTrack, expected: BaselineStream): void {
  expect(track).toBeDefined();
  expect(track.kind).toBe(expected.kind);
  expect(track.codecFamily).toBe(codecFamily(expected.codec));

  if (track.kind === 'video') {
    if (expected.width !== null) expect(track.width).toBe(expected.width);
    if (expected.height !== null) expect(track.height).toBe(expected.height);
  }
  if (track.kind === 'audio') {
    if (expected.sampleRate !== null) expect(track.sampleRate).toBe(expected.sampleRate);
    if (expected.channels !== null) expect(track.channels).toBe(expected.channels);
  }
  if (expected.frameCount !== null && track.codecFamily !== 'pcm') {
    expect(Math.abs(track.sampleCount - expected.frameCount)).toBeLessThanOrEqual(5);
  }
}

function codecFamily(codec: string): CodecFamily {
  if (codec === 'h264') return 'h264';
  if (codec === 'hevc' || codec === 'h265') return 'h265';
  if (codec === 'aac') return 'aac';
  if (codec === 'mp3') return 'mp3';
  if (codec.startsWith('pcm_')) return 'pcm';
  return 'unknown';
}
