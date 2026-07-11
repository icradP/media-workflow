import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type {
  CodecFamily,
  DetectedMediaFormat,
  MediaSource,
} from '@media-workflow/core';
import { analyzeMediaSource } from '../analyze.js';

interface BaselineStream {
  id: string | null;
  kind: 'audio' | 'video' | 'data';
  codec: string;
  profile: string | null;
  timeBase: string | null;
  sampleRate: number | null;
  channels: number | null;
  width: number | null;
  height: number | null;
  frameCount: number | null;
}

interface BaselineRecord {
  input: {
    file: string;
    size: number;
    sha256: string;
  };
  expected: {
    format: { name: string; durationSeconds: number | null };
    streamCount: number;
    streams: BaselineStream[];
  };
  decodeValidation: {
    exitCode: number;
    warnings: string[];
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

describe('real media fixtures match FFprobe baselines', () => {
  it.each(records)('$input.file', record => {
    const data = new Uint8Array(readFileSync(join(root, record.input.file)));
    const sha256 = createHash('sha256').update(data).digest('hex');
    const source: MediaSource = {
      sourceId: `fixture:${record.input.sha256}`,
      version: record.input.sha256,
      kind: 'file',
      name: record.input.file,
      size: data.byteLength,
      data,
      metadata: {},
    };

    const asset = analyzeMediaSource(source);
    const expectedFormat = normalizeFormat(record.expected.format.name);

    expect(asset.source.size).toBe(record.input.size);
    expect(sha256).toBe(record.input.sha256);
    expect(asset.container.format).toBe(expectedFormat);
    expect(asset.tracks).toHaveLength(record.expected.streamCount);
    const ffmpegFoundNonMonotonicDts = record.decodeValidation.warnings.some(warning =>
      warning.includes('non monotonically increasing dts'),
    );
    const analyzerFoundNonMonotonicDts = asset.diagnostics.some(diagnostic =>
      diagnostic.code === 'asset.non_monotonic_dts',
    );
    expect(analyzerFoundNonMonotonicDts).toBe(ffmpegFoundNonMonotonicDts);
    if (record.expected.format.durationSeconds !== null) {
      expect(asset.container.durationUs).toBeDefined();
      const expectedDurationUs = record.expected.format.durationSeconds * 1_000_000;
      const toleranceUs = Math.max(100_000, expectedDurationUs * 0.01);
      expect(Math.abs((asset.container.durationUs ?? 0) - expectedDurationUs)).toBeLessThanOrEqual(
        toleranceUs,
      );
    }

    for (const expected of record.expected.streams) {
      const actual = asset.tracks.find(track =>
        track.kind === expected.kind &&
        track.codecFamily === normalizeCodec(expected.codec),
      );
      expect(actual, `missing ${expected.kind}/${expected.codec}`).toBeDefined();
      if (!actual) continue;
      if (expected.id?.startsWith('0x')) {
        expect(actual.metadata.sourceId).toBe(Number.parseInt(expected.id.slice(2), 16));
      }
      if (expected.timeBase === '1/1000' || expected.timeBase === '1/90000') {
        expect(`${actual.timeBase?.numerator}/${actual.timeBase?.denominator}`).toBe(
          expected.timeBase,
        );
      }

      if (actual.kind === 'video') {
        if (expected.width !== null) expect(actual.width).toBe(expected.width);
        if (expected.height !== null) expect(actual.height).toBe(expected.height);
        if (expected.profile !== null) {
          expect(actual.profile?.toLowerCase()).toContain(profileToken(expected.profile));
        }
      }
      if (actual.kind === 'audio') {
        if (expected.sampleRate !== null) expect(actual.sampleRate).toBe(expected.sampleRate);
        if (expected.channels !== null) expect(actual.channels).toBe(expected.channels);
        if (expected.profile !== null) {
          expect(actual.profile?.toLowerCase()).toContain(profileToken(expected.profile));
        }
      }
      if (expected.frameCount !== null) {
        expect(Math.abs(actual.sampleCount - expected.frameCount)).toBeLessThanOrEqual(5);
      }
    }
  }, 30_000);
});

function normalizeFormat(value: string): DetectedMediaFormat {
  if (value.includes('mp4') || value.includes('mov')) return 'mp4';
  if (value === 'mpegts') return 'mpegts';
  if (value === 'flv') return 'flv';
  if (value === 'wav') return 'wav';
  if (value === 'mp3') return 'mp3';
  return 'unknown';
}

function normalizeCodec(value: string): CodecFamily {
  if (value === 'h264') return 'h264';
  if (value === 'hevc' || value === 'h265') return 'h265';
  if (value === 'aac') return 'aac';
  if (value === 'mp3') return 'mp3';
  if (value.startsWith('pcm_')) return 'pcm';
  return 'unknown';
}

function profileToken(value: string): string {
  const normalized = value.toLowerCase();
  if (normalized.includes('baseline')) return 'baseline';
  if (normalized === 'lc') return 'lc';
  return normalized;
}
