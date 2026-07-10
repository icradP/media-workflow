import { describe, expect, it } from 'vitest';
import type {
  MediaAnalysisResult,
  MediaProbe,
  MediaSource,
} from '@media-workflow/core';
import { analyzeMediaSource } from '../analyze.js';
import { normalizeAnalysis } from '../normalize.js';

describe('canonical media normalization', () => {
  it.each([
    ['flv', minimalFlv()],
    ['mpegts', minimalMpegTs()],
    ['mpegps', Uint8Array.of(0x00, 0x00, 0x01, 0xba, 0, 0, 0, 0, 0, 0, 0, 0)],
    ['mp4', minimalMp4()],
    ['wav', minimalWav()],
    ['flac', minimalFlac()],
    ['mp3', Uint8Array.of(0xff, 0xfb, 0x90, 0x64)],
    ['opus', minimalOpus()],
    ['unknown', Uint8Array.of(1, 2, 3, 4)],
  ] as const)('normalizes a %s fixture without leaking container-specific shape', (format, bytes) => {
    const asset = analyzeMediaSource(sourceFor(format, bytes));

    expect(asset.probe.format).toBe(format);
    expect(asset.container.format).toBe(format);
    expect(asset.source.data).toBe(bytes);
    expect(Array.isArray(asset.tracks)).toBe(true);
    expect(Array.isArray(asset.samples)).toBe(true);
    expect(Array.isArray(asset.diagnostics)).toBe(true);
  });

  it('repairs an audio-only FLV legacy stream index mismatch', () => {
    const source = sourceFor('flv', minimalFlv());
    const probe: MediaProbe = {
      sourceId: source.sourceId,
      format: 'flv',
      confidence: 1,
      candidates: [{ format: 'flv', confidence: 1, reason: 'test' }],
      diagnostics: [],
    };
    const legacy: MediaAnalysisResult = {
      format: { container: 'flv', subtype: 'flv', details: {} },
      streams: [{
        index: 0,
        kind: 'audio',
        codec: 'AAC',
        codecFamily: 'aac',
        codecConfig: null,
        audio: { sampleRate: 48_000, channels: 2 },
      }],
      frames: [{
        index: 0,
        streamIndex: 1,
        kind: 'audio',
        dts: 10,
        pts: 10,
        offset: 13,
        size: 32,
        isKey: false,
      }],
      formatSpecific: {},
    };

    const asset = normalizeAnalysis(source, probe, legacy, 1);

    expect(asset.tracks).toHaveLength(1);
    expect(asset.samples[0]?.trackId).toBe(asset.tracks[0]?.trackId);
    expect(asset.samples[0]?.ptsUs).toBe(10_000);
  });
});

function sourceFor(format: string, data: Uint8Array): MediaSource {
  return {
    sourceId: `test:${format}`,
    version: '1',
    kind: 'memory',
    name: `fixture.${format}`,
    size: data.byteLength,
    data,
    metadata: {},
  };
}

function minimalFlv(): Uint8Array {
  return Uint8Array.of(
    0x46, 0x4c, 0x56, 0x01, 0x00, 0x00, 0x00, 0x00, 0x09,
    0x00, 0x00, 0x00, 0x00,
  );
}

function minimalMpegTs(): Uint8Array {
  const bytes = new Uint8Array(188 * 5);
  for (let offset = 0; offset < bytes.length; offset += 188) {
    bytes[offset] = 0x47;
    bytes[offset + 1] = 0x1f;
    bytes[offset + 2] = 0xff;
    bytes[offset + 3] = 0x10;
  }
  return bytes;
}

function minimalMp4(): Uint8Array {
  return Uint8Array.of(
    0x00, 0x00, 0x00, 0x10,
    0x66, 0x74, 0x79, 0x70,
    0x69, 0x73, 0x6f, 0x6d,
    0x00, 0x00, 0x00, 0x00,
  );
}

function minimalWav(): Uint8Array {
  const bytes = new Uint8Array(44);
  const view = new DataView(bytes.buffer);
  writeAscii(bytes, 0, 'RIFF');
  view.setUint32(4, 36, true);
  writeAscii(bytes, 8, 'WAVE');
  writeAscii(bytes, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, 48_000, true);
  view.setUint16(34, 16, true);
  writeAscii(bytes, 36, 'data');
  return bytes;
}

function minimalFlac(): Uint8Array {
  const bytes = new Uint8Array(42);
  writeAscii(bytes, 0, 'fLaC');
  return bytes;
}

function minimalOpus(): Uint8Array {
  const bytes = new Uint8Array(47);
  writeAscii(bytes, 0, 'OggS');
  writeAscii(bytes, 28, 'OpusHead');
  bytes[37] = 2;
  new DataView(bytes.buffer).setUint32(40, 48_000, true);
  return bytes;
}

function writeAscii(bytes: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index++) {
    bytes[offset + index] = value.charCodeAt(index);
  }
}
