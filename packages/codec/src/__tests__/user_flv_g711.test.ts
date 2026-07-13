import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  analyzeMediaSource,
  materializeMediaSelection,
  remuxMediaSelectionsToMp4,
  selectTrack,
} from '@media-workflow/codec';

const USER_FLV = '/Users/icrad/Downloads/865478070000320.flv';

describe('user FLV fixture', () => {
  it('detects G.711 A-law audio-only FLV', () => {
    let data: Uint8Array;
    try {
      data = new Uint8Array(readFileSync(USER_FLV));
    } catch {
      return;
    }

    const asset = analyzeMediaSource({
      sourceId: 'user-flv',
      version: 'test',
      kind: 'file',
      name: '865478070000320.flv',
      size: data.byteLength,
      data,
      metadata: {},
    });

    const audio = asset.tracks.find(track => track.kind === 'audio');
    expect(audio?.codecFamily).toBe('g711');
    expect(audio?.sampleRate).toBe(8000);
    expect(audio?.channels).toBe(1);

    const selection = materializeMediaSelection(
      selectTrack(asset, { kind: 'audio', index: 0 }),
    );
    expect(() => remuxMediaSelectionsToMp4({ audio: selection })).toThrow(/G\.711/);
    expect(() => remuxMediaSelectionsToMp4({ audio: selection })).toThrow(/Audio Decode → AAC Encoder/);
    expect(() => remuxMediaSelectionsToMp4({ audio: selection })).toThrow(/Direct remux supports/);
  });
});
