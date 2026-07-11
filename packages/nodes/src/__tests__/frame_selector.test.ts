import { describe, expect, it } from 'vitest';
import {
  createContext,
  type MediaAsset,
  type MediaSample,
  type MediaTrack,
} from '@media-workflow/core';
import { frameSelectorNode } from '../utility/frame_selector.js';

const track: MediaTrack = {
  trackId: 'mp4:video:1',
  index: 0,
  kind: 'video',
  codec: 'H.264',
  codecFamily: 'h264',
  codecConfig: null,
  sampleCount: 6,
  metadata: {},
};

const samples: MediaSample[] = [
  sample(0, 0, true, 'IDR'),
  sample(1, 40_000, false, 'P'),
  sample(2, 80_000, false, 'B'),
  sample(3, 120_000, true, 'I'),
  sample(4, 160_000, false, 'P'),
  sample(5, 200_000, false, 'B'),
];

const asset: MediaAsset = {
  source: {
    sourceId: 'fixture',
    version: '1',
    kind: 'memory',
    name: 'fixture.mp4',
    size: 0,
    data: new Uint8Array(),
    metadata: {},
  },
  probe: {
    sourceId: 'fixture',
    format: 'mp4',
    confidence: 1,
    candidates: [{ format: 'mp4', confidence: 1, reason: 'test' }],
    diagnostics: [],
  },
  container: { format: 'mp4', longName: 'MP4', metadata: {} },
  tracks: [track],
  samples,
  metadata: {},
  diagnostics: [],
  analyzedAt: '2026-01-01T00:00:00.000Z',
  analysisDurationMs: 1,
};

describe('Frame Selector', () => {
  it('selects an inclusive track-local index range', async () => {
    const selected = await execute({ startIndex: 1, endIndex: 3 });
    expect(selected.map(item => item.index)).toEqual([1, 2, 3]);
  });

  it('combines relative time range and picture type filters', async () => {
    const selected = await execute({
      startTimeSeconds: 0.08,
      endTimeSeconds: 0.2,
      frameType: 'B',
    });
    expect(selected.map(item => item.index)).toEqual([2, 5]);
  });

  it('filters key and non-key samples', async () => {
    expect((await execute({ frameType: 'key' })).map(item => item.index)).toEqual([0, 3]);
    expect((await execute({ frameType: 'non_key' })).map(item => item.index)).toEqual([
      1, 2, 4, 5,
    ]);
  });

  it('can return only the first matching key frame', async () => {
    const selected = await execute({ frameType: 'key', limit: 1 });
    expect(selected.map(item => item.index)).toEqual([0]);
  });

  it('rejects a track from another asset', async () => {
    await expect(execute({}, { ...track, trackId: 'other' })).rejects.toThrow(
      'does not belong to this asset',
    );
  });
});

async function execute(
  overrides: Record<string, unknown>,
  selectedTrack: MediaTrack = track,
): Promise<MediaSample[]> {
  const params = Object.fromEntries(
    Object.entries(frameSelectorNode.params!).map(([name, definition]) => [
      name,
      overrides[name] ?? definition.default,
    ]),
  );
  const result = await frameSelectorNode.execute(
    createContext(new AbortController().signal),
    {
      inputs: { asset, track: selectedTrack },
      params,
    },
  );
  return result.samples;
}

function sample(
  index: number,
  relativePtsUs: number,
  isKey: boolean,
  pictureType: string,
): MediaSample {
  return {
    sampleId: `sample-${index}`,
    index,
    trackId: track.trackId,
    ptsUs: 1_000_000 + relativePtsUs,
    dtsUs: 1_000_000 + relativePtsUs,
    durationUs: 40_000,
    offset: index * 100,
    size: 100,
    isKey,
    pictureType,
    metadata: {},
  };
}
