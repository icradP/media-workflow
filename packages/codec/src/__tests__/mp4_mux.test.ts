import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { MediaSource } from '@media-workflow/core';
import {
  analyzeMediaSource,
  isMp4OrFmp4Signature,
  materializeMediaSelection,
  parseMp4Metadata,
  remuxMediaAssetToMp4,
  remuxMediaSelectionsToMp4,
  selectTrack,
} from '@media-workflow/codec';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

function loadAsset(relativePath: string, sourceId?: string) {
  const data = new Uint8Array(readFileSync(join(root, relativePath)));
  const source: MediaSource = {
    sourceId: sourceId ?? `fixture:${relativePath}`,
    version: 'test',
    kind: 'file',
    name: relativePath,
    size: data.byteLength,
    data,
    metadata: {},
  };
  return analyzeMediaSource(source);
}

describe('MP4 muxer', () => {
  it('remuxes generated MP4 fixtures into a playable MP4 file', () => {
    const asset = loadAsset('tests/generated-av.mp4');
    const result = remuxMediaAssetToMp4(asset, {
      includeVideo: true,
      includeAudio: true,
    });

    expect(result.data.byteLength).toBeGreaterThan(1024);
    expect(isMp4OrFmp4Signature(result.data)).toBe(true);
    expect(result.videoSampleCount).toBeGreaterThan(0);
    expect(result.audioSampleCount).toBeGreaterThan(0);

    const metadata = parseMp4Metadata(result.data);
    expect(metadata?.trackCount).toBeGreaterThanOrEqual(2);
    expect(metadata?.durationMs).toBeGreaterThan(0);
  });

  it('supports partial time ranges', () => {
    const asset = loadAsset('tests/generated-av.mp4');
    const full = remuxMediaAssetToMp4(asset);
    const partial = remuxMediaAssetToMp4(asset, {
      startTimeUs: 0,
      endTimeUs: 500_000,
    });

    expect(partial.data.byteLength).toBeLessThan(full.data.byteLength);
    expect(partial.videoSampleCount).toBeGreaterThan(0);
  });

  it('remuxes independent video and audio media selections', () => {
    const asset = loadAsset('tests/generated-av.mp4');
    const video = materializeMediaSelection(
      selectTrack(asset, { kind: 'video', index: 0 }),
      { limit: 10, order: 'presentation' },
    );
    const audio = materializeMediaSelection(
      selectTrack(asset, { kind: 'audio', index: 0 }),
      { startTimeUs: 0, endTimeUs: 500_000, order: 'presentation' },
    );

    const result = remuxMediaSelectionsToMp4({ video, audio });
    expect(result.videoSampleCount).toBe(10);
    expect(result.audioSampleCount).toBeGreaterThan(0);
    expect(isMp4OrFmp4Signature(result.data)).toBe(true);
    expect(parseMp4Metadata(result.data)?.trackCount).toBeGreaterThanOrEqual(2);
  });

  it('allows video and audio selections from different media sources', () => {
    const videoAsset = loadAsset('tests/generated-av.mp4', 'source:video');
    const audioAsset = loadAsset('tests/generated-av.mp4', 'source:audio');
    const video = materializeMediaSelection(
      selectTrack(videoAsset, { kind: 'video', index: 0 }),
      { limit: 12, order: 'presentation' },
    );
    const audio = materializeMediaSelection(
      selectTrack(audioAsset, { kind: 'audio', index: 0 }),
      { order: 'presentation' },
    );

    const result = remuxMediaSelectionsToMp4({
      video,
      audio,
      align: 'trim_to_video',
    });
    expect(result.videoSampleCount).toBe(12);
    expect(result.audioSampleCount).toBeLessThan(
      audio.samples.length,
    );
    expect(result.audioSampleCount).toBeGreaterThan(0);
  });

  it('can trim video to the audio selection span', () => {
    const asset = loadAsset('tests/generated-av.mp4');
    const video = materializeMediaSelection(
      selectTrack(asset, { kind: 'video', index: 0 }),
      { order: 'presentation' },
    );
    const audio = materializeMediaSelection(
      selectTrack(asset, { kind: 'audio', index: 0 }),
      { startTimeUs: 0, endTimeUs: 400_000, order: 'presentation' },
    );

    const trimmed = remuxMediaSelectionsToMp4({
      video,
      audio,
      align: 'trim_to_audio',
    });
    expect(trimmed.videoSampleCount).toBeLessThan(video.samples.length);
    expect(trimmed.audioSampleCount).toBe(audio.samples.length);
  });

  it('remuxes MP4 video with MP3 audio from different sources', () => {
    const videoAsset = loadAsset('tests/generated-av.mp4', 'source:video');
    const audioAsset = loadAsset('tests/Duvet.mp3', 'source:audio');
    const video = materializeMediaSelection(
      selectTrack(videoAsset, { kind: 'video', index: 0 }),
      { order: 'presentation' },
    );
    const audio = materializeMediaSelection(
      selectTrack(audioAsset, { kind: 'audio', index: 0 }),
      { order: 'presentation' },
    );

    expect(audio.selectedTrack.track.codecFamily).toBe('mp3');
    expect(audio.selectedTrack.track.codecConfig).toBeNull();

    const result = remuxMediaSelectionsToMp4({
      video,
      audio,
      align: 'trim_to_video',
    });
    expect(result.videoSampleCount).toBeGreaterThan(0);
    expect(result.audioSampleCount).toBeGreaterThan(0);
    expect(isMp4OrFmp4Signature(result.data)).toBe(true);
    expect(parseMp4Metadata(result.data)?.audioTrackCount).toBeGreaterThan(0);
  });
});
