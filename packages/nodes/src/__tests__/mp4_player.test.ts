import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createContext, type MediaSource } from '@media-workflow/core';
import { remuxMediaAssetToMp4, analyzeMediaSource } from '@media-workflow/codec';
import { mp4PlayerNode, normalizeMp4Input } from '../display/mp4_player.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

describe('MP4 Player', () => {
  it('plays remuxed MP4 media files', async () => {
    const data = new Uint8Array(readFileSync(join(root, 'tests/generated-av.mp4')));
    const source: MediaSource = {
      sourceId: 'fixture:generated-av',
      version: 'test',
      kind: 'file',
      name: 'generated-av.mp4',
      size: data.byteLength,
      data,
      metadata: {},
    };
    const asset = analyzeMediaSource(source);
    const remuxed = remuxMediaAssetToMp4(asset);
    const result = await mp4PlayerNode.execute(
      createContext(new AbortController().signal),
      {
        inputs: {
          source: {
            fileName: 'output.mp4',
            mimeType: 'video/mp4',
            extension: 'mp4',
            data: remuxed.data,
            metadata: {},
          },
        },
        params: { autoplay: false },
      },
    );

    const preview = JSON.parse(result.preview);
    expect(preview).toMatchObject({
      fileName: 'output.mp4',
      byteLength: remuxed.data.byteLength,
    });
    expect(preview.durationMs).toBeGreaterThan(0);
    expect(preview.videoTrackCount).toBeGreaterThan(0);
  });

  it('accepts loaded MP4 media sources', () => {
    const data = new Uint8Array(readFileSync(join(root, 'tests/generated-av.mp4')));
    const source: MediaSource = {
      sourceId: 'fixture:generated-av',
      version: 'test',
      kind: 'file',
      name: 'clip.mp4',
      size: data.byteLength,
      data,
      metadata: {},
    };

    const file = normalizeMp4Input(source);
    expect(file.fileName).toBe('clip.mp4');
    expect(file.data).toEqual(data);
  });

  it('rejects non-MP4 bytes', () => {
    expect(() => normalizeMp4Input({
      fileName: 'bad.mp4',
      mimeType: 'video/mp4',
      extension: 'mp4',
      data: Uint8Array.of(0, 1, 2, 3),
      metadata: {},
    })).toThrow('ftyp signature');
  });
});
