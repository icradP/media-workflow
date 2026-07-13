import { describe, expect, it } from 'vitest';
import {
  type MediaAsset,
  type MediaSample,
  type MediaTrack,
} from '@media-workflow/core';
import {
  materializeMediaSelection,
  selectTrack,
} from '@media-workflow/codec';

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

describe('MediaSelection', () => {
  it('selects an inclusive track-local index range', async () => {
    const selected = await execute({ startIndex: 1, endIndex: 3 });
    expect(selected.map(item => item.index)).toEqual([1, 2, 3]);
  });

  it('combines a half-open relative time range and picture type filters', async () => {
    const selected = await execute({
      startTimeSeconds: 0.08,
      endTimeSeconds: 0.2,
      frameType: 'B',
    });
    expect(selected.map(item => item.index)).toEqual([2]);
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
    expect(() => selectTrack(asset, { trackId: 'other' })).toThrow('No track matched');
  });

  it('uses a deterministic selection ID', async () => {
    const first = select({ startIndex: 1, endIndex: 3 });
    const second = select({ startIndex: 1, endIndex: 3 });
    expect(first.selectionId).toBe(second.selectionId);
  });

  it('keeps presentation selection independent from DTS order', () => {
    const reorderedAsset: MediaAsset = {
      ...asset,
      samples: samples.map((item, index) => ({
        ...item,
        dtsUs: index === 1 ? 1_080_000 : index === 2 ? 1_040_000 : item.dtsUs,
      })),
    };
    const selection = materializeMediaSelection(
      selectTrack(reorderedAsset, { kind: 'video' }),
      { startIndex: 1, endIndex: 1, order: 'presentation' },
    );
    expect(selection.samples.map(item => item.index)).toEqual([1]);
  });
});

async function execute(
  overrides: Record<string, unknown>,
  selectedTrack: MediaTrack = track,
): Promise<MediaSample[]> {
  return select(overrides, selectedTrack).samples;
}

function select(
  overrides: Record<string, unknown>,
  selectedTrack: MediaTrack = track,
) {
  const trackSelection = selectTrack(asset, { trackId: selectedTrack.trackId });
  return materializeMediaSelection(trackSelection, {
    startIndex: Number(overrides.startIndex ?? 0),
    endIndex: Number(overrides.endIndex ?? -1),
    startTimeUs: Number(overrides.startTimeSeconds ?? 0) * 1_000_000,
    endTimeUs: Number(overrides.endTimeSeconds ?? -1) >= 0
      ? Number(overrides.endTimeSeconds) * 1_000_000
      : undefined,
    frameType: String(overrides.frameType ?? 'all') as never,
    limit: Number(overrides.limit ?? -1),
    order: 'presentation',
  });
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
