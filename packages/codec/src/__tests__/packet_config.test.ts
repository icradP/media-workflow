import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { MediaSource } from '@media-workflow/core';
import { analyzeMediaSource } from '../analyze.js';
import { buildDecoderConfig } from '../packet/config.js';
import { sampleToEncodedPacket } from '../packet/normalize.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

function loadAsset(relativePath: string) {
  const data = new Uint8Array(readFileSync(join(root, relativePath)));
  const source: MediaSource = {
    sourceId: `fixture:${relativePath}`,
    version: 'test',
    kind: 'file',
    name: relativePath,
    size: data.byteLength,
    data,
    metadata: {},
  };
  return analyzeMediaSource(source);
}

describe('decoder config and packet normalization', () => {
  it('builds H.264 decoder config for MP4 fixtures', () => {
    const asset = loadAsset('tests/generated-av.mp4');
    const videoTrack = asset.tracks.find(track => track.kind === 'video');
    expect(videoTrack?.decoderConfig).toBeDefined();
    expect(videoTrack?.decoderConfig?.codec).toMatch(/^avc1\./);
    expect(videoTrack?.decoderConfig?.bitstreamFormat).toBe('avcc');
  });

  it('builds AAC decoder config for FLV fixtures', () => {
    const asset = loadAsset('tests/869247060193353-ok.flv');
    const audioTrack = asset.tracks.find(track => track.kind === 'audio');
    expect(audioTrack?.decoderConfig).toBeDefined();
    expect(audioTrack?.decoderConfig?.codec).toMatch(/^mp4a\.40\./);
    expect(audioTrack?.decoderConfig?.bitstreamFormat).toBe('aac_raw');
  });

  it('uses annexb packets for MPEG-TS video', () => {
    const asset = loadAsset('tests/test.ts');
    const videoTrack = asset.tracks.find(track => track.kind === 'video');
    expect(videoTrack?.decoderConfig?.bitstreamFormat).toBe('annexb');
    const sample = asset.samples.find(item => item.trackId === videoTrack?.trackId && item.isKey);
    expect(sample).toBeDefined();
    const packet = sampleToEncodedPacket(sample!, videoTrack!, asset.container.format);
    expect(packet?.bitstreamFormat).toBe('annexb');
    expect(packet?.data.byteLength).toBeGreaterThan(0);
  });

  it('rebuilds decoder config from track metadata when needed', () => {
    const asset = loadAsset('tests/generated-av.mp4');
    const track = asset.tracks.find(candidate => candidate.kind === 'video');
    expect(track).toBeDefined();
    const rebuilt = buildDecoderConfig(track!, asset.container.format);
    expect(rebuilt?.codec).toBe(track?.decoderConfig?.codec);
  });
});
