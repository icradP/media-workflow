import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  createMemoryCache,
  executeGraph,
  type CodecFamily,
  type MediaAsset,
  type MediaSource,
  type MediaTrack,
  type NodeDefinition,
} from '@media-workflow/core';
import { instantiateWorkflowPreset, type WorkflowPreset } from '../preset.js';
import { fileLoaderNode } from '../source/file_loader.js';

interface BaselineStream {
  kind: 'audio' | 'video' | 'data';
  codec: string;
  frameCount: number | null;
  sampleRate: number | null;
  channels: number | null;
  width: number | null;
  height: number | null;
}

interface BaselineRecord {
  input: { file: string; size: number; sha256: string };
  expected: {
    format: { name: string; durationSeconds: number | null };
    streamCount: number;
    streams: BaselineStream[];
    firstKeyVideoPacket?: {
      size: number;
      sha256: string;
      hexPrefix: string;
    } | null;
  };
  decodeValidation: { warnings: string[] };
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const workflowsDir = join(root, 'tests', 'workflows');
const baselinesDir = join(root, 'tests', 'fixtures', 'ffprobe');
const overviewPreset = readPreset('ffprobe-overview.workflow.json');
const videoPreset = readPreset('ffprobe-video-track.workflow.json');
const audioPreset = readPreset('ffprobe-audio-track.workflow.json');
const records = readdirSync(baselinesDir)
  .filter(file => file.endsWith('.ffprobe.json'))
  .sort()
  .map(file =>
    JSON.parse(readFileSync(join(baselinesDir, file), 'utf8')) as BaselineRecord,
  );

describe('FFprobe workflow presets', () => {
  it.each(records)('overview: $input.file', async record => {
    const source = sourceFromRecord(record);
    const results = await runPreset(overviewPreset, source);
    const asset = results.get('analyze')?.get('asset') as MediaAsset;
    const tracks = results.get('overview')?.get('tracks') as MediaTrack[];
    const frameSamples = results.get('frames')?.get('samples');
    const hexPreview = JSON.parse(String(results.get('raw-hex')?.get('preview')));

    expect(asset.source.size).toBe(record.input.size);
    expect(asset.tracks).toHaveLength(record.expected.streamCount);
    expect(tracks).toBe(asset.tracks);
    expect(frameSamples).toBe(asset.samples);
    expect(hexPreview.byteLength).toBe(Math.min(256, source.size));
    expect(asset.container.format).toBe(expectedFormat(record.expected.format.name));

    const ffmpegHasDtsWarning = record.decodeValidation.warnings.some(message =>
      message.includes('non monotonically increasing dts'),
    );
    expect(asset.diagnostics.some(item => item.code === 'asset.non_monotonic_dts')).toBe(
      ffmpegHasDtsWarning,
    );
  }, 30_000);

  it.each(records.flatMap(record =>
    record.expected.streams
      .filter(stream => stream.kind === 'video' || stream.kind === 'audio')
      .map(stream => ({ record, stream })),
  ))('$stream.kind track: $record.input.file', async ({ record, stream }) => {
    const source = sourceFromRecord(record);
    const preset = stream.kind === 'video' ? videoPreset : audioPreset;
    const results = await runPreset(preset, source);
    const track = results.get('track')?.get('track') as MediaTrack;
    const asset = results.get('analyze')?.get('asset') as MediaAsset;
    const selectedFrames = results.get('select-frames')?.get('samples') as Array<{
      trackId: string;
      data?: Uint8Array;
    }>;
    const frameTable = results.get('frame-table')?.get('samples');
    const hexPreview = JSON.parse(String(results.get('frame-hex')?.get('preview')));

    expect(track.kind).toBe(stream.kind);
    expect(track.codecFamily).toBe(codecFamily(stream.codec));
    assertTechnicalDetails(track, stream);

    const available = asset.samples.filter(sample => sample.trackId === track.trackId);
    const expectedSelectionCount = stream.kind === 'video'
      ? Math.min(1, available.filter(sample => sample.isKey).length)
      : Math.min(50, available.length);
    expect(selectedFrames).toHaveLength(expectedSelectionCount);
    expect(selectedFrames.every(sample => sample.trackId === track.trackId)).toBe(true);
    expect(frameTable).toBe(selectedFrames);
    const expectedBytes = selectedFrames
      .map(sample => sample.data?.byteLength ?? 0)
      .reduce((total, length) => total + length, 0);
    expect(hexPreview.byteLength).toBe(Math.min(512, expectedBytes));

    if (stream.kind === 'video' && record.expected.firstKeyVideoPacket) {
      const frameData = selectedFrames[0]?.data;
      expect(frameData).toBeDefined();
      if (frameData) {
        expect(frameData.byteLength).toBe(record.expected.firstKeyVideoPacket.size);
        expect(createHash('sha256').update(frameData).digest('hex')).toBe(
          record.expected.firstKeyVideoPacket.sha256,
        );
        expect(String(hexPreview.hex).replace(/\s+/g, '')).toBe(
          record.expected.firstKeyVideoPacket.hexPrefix,
        );
      }
    }
  }, 30_000);
});

async function runPreset(preset: WorkflowPreset, source: MediaSource) {
  const sourceNode: NodeDefinition = {
    ...fileLoaderNode,
    async execute() {
      return { source };
    },
  } as NodeDefinition;
  const graph = instantiateWorkflowPreset(preset, {
    nodeOverrides: new Map([['file', sourceNode]]),
  });
  return executeGraph(
    graph,
    createMemoryCache(),
    new AbortController().signal,
  );
}

function sourceFromRecord(record: BaselineRecord): MediaSource {
  const data = new Uint8Array(readFileSync(join(root, record.input.file)));
  const sha256 = createHash('sha256').update(data).digest('hex');
  expect(sha256).toBe(record.input.sha256);
  return {
    sourceId: `fixture:${sha256}`,
    version: sha256,
    kind: 'file',
    name: record.input.file,
    size: data.byteLength,
    data,
    metadata: {},
  };
}

function readPreset(fileName: string): WorkflowPreset {
  return JSON.parse(
    readFileSync(join(workflowsDir, fileName), 'utf8'),
  ) as WorkflowPreset;
}

function assertTechnicalDetails(track: MediaTrack, expected: BaselineStream): void {
  if (track.kind === 'video') {
    if (expected.width !== null) expect(track.width).toBe(expected.width);
    if (expected.height !== null) expect(track.height).toBe(expected.height);
  }
  if (track.kind === 'audio') {
    if (expected.sampleRate !== null) expect(track.sampleRate).toBe(expected.sampleRate);
    if (expected.channels !== null) expect(track.channels).toBe(expected.channels);
  }
  if (expected.frameCount !== null) {
    expect(Math.abs(track.sampleCount - expected.frameCount)).toBeLessThanOrEqual(5);
  }
}

function expectedFormat(format: string): string {
  if (format.includes('mp4') || format.includes('mov')) return 'mp4';
  return format;
}

function codecFamily(codec: string): CodecFamily {
  if (codec === 'h264') return 'h264';
  if (codec === 'hevc' || codec === 'h265') return 'h265';
  if (codec === 'aac') return 'aac';
  if (codec === 'mp3') return 'mp3';
  if (codec.startsWith('pcm_')) return 'pcm';
  return 'unknown';
}
