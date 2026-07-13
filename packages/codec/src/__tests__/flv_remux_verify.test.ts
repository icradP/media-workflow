import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { MediaSource } from '@media-workflow/core';
import { describe, expect, it } from 'vitest';
import {
  analyzeMediaSource,
  inferVideoCodecConfig,
  isMp4OrFmp4Signature,
  materializeMediaSelection,
  remuxMediaSelectionsToMp4,
  selectTrack,
} from '@media-workflow/codec';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const outputDir = join(root, 'tests', 'output');

function loadAsset(relativePath: string) {
  const data = new Uint8Array(readFileSync(join(root, relativePath)));
  const source: MediaSource = {
    sourceId: `verify:${relativePath}`,
    version: 'verify',
    kind: 'file',
    name: relativePath,
    size: data.byteLength,
    data,
    metadata: {},
  };
  return analyzeMediaSource(source);
}

describe('FLV remux verification', () => {
  it('parses generated FLV and remuxes to MP4', () => {
    mkdirSync(outputDir, { recursive: true });

    const flvAsset = loadAsset('tests/generated-av.flv');
    expect(flvAsset.container.format).toBe('flv');

    const videoTrack = flvAsset.tracks.find(track => track.kind === 'video');
    const audioTrack = flvAsset.tracks.find(track => track.kind === 'audio');
    expect(videoTrack?.codecFamily).toBe('h264');
    expect(audioTrack?.codecFamily).toBe('aac');

    const resolvedConfig = videoTrack?.codecConfig ??
      inferVideoCodecConfig({ ...videoTrack!, codecConfig: null }, flvAsset.samples);
    expect(resolvedConfig?.byteLength).toBeGreaterThan(10);

    const muxed = remuxMediaSelectionsToMp4({
      video: materializeMediaSelection(selectTrack(flvAsset, { kind: 'video', index: 0 })),
      audio: materializeMediaSelection(selectTrack(flvAsset, { kind: 'audio', index: 0 })),
      align: 'trim_to_video',
    });

    expect(muxed.videoSampleCount).toBeGreaterThan(0);
    expect(muxed.audioSampleCount).toBeGreaterThan(0);
    expect(isMp4OrFmp4Signature(muxed.data)).toBe(true);

    const outputPath = join(outputDir, 'flv-remux-verify.mp4');
    writeFileSync(outputPath, muxed.data);

    const ffprobe = spawnSync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=format_name,duration:stream=codec_name,codec_type',
      '-of', 'default=nw=1',
      outputPath,
    ], { encoding: 'utf8' });

    expect(ffprobe.status).toBe(0);
    expect(ffprobe.stdout).toContain('codec_name=h264');
    expect(ffprobe.stdout).toContain('codec_name=aac');
  });
});
