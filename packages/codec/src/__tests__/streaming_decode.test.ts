import { describe, expect, it } from 'vitest';
import type {
  MediaAsset,
  MediaSample,
  MediaSelection,
  VideoMediaTrack,
} from '@media-workflow/core';
import { buildEncodedTrackFromSelection } from '../packet/encoded_track.js';
import {
  decodedWindowCapacity,
  StreamingVideoDecoder,
} from '../video/streaming_video_decoder.js';

const videoTrack: VideoMediaTrack = {
  trackId: 'mp4:video:0',
  index: 0,
  kind: 'video',
  codec: 'H.264',
  codecFamily: 'h264',
  codecConfig: new Uint8Array([1, 0x42, 0, 0x1e]),
  sampleCount: 3,
  metadata: {},
  width: 640,
  height: 360,
  frameRate: 30,
  decoderConfig: {
    codec: 'avc1.42001e',
    codecFamily: 'h264',
    description: new Uint8Array([1, 0x42, 0, 0x1e]),
    bitstreamFormat: 'avcc',
    codedWidth: 640,
    codedHeight: 360,
    metadata: {},
  },
};

function sample(index: number, ptsUs: number, dtsUs: number, isKey: boolean): MediaSample {
  return {
    sampleId: `${videoTrack.trackId}:${index}`,
    index,
    trackId: videoTrack.trackId,
    ptsUs,
    dtsUs,
    durationUs: 33_333,
    offset: index * 16,
    size: 8,
    isKey,
    data: new Uint8Array([0, 0, 0, 4, isKey ? 0x65 : 0x41, 1, 2, 3]),
    metadata: {},
  };
}

function selectionFromSamples(samples: MediaSample[]): MediaSelection {
  const asset: MediaAsset = {
    source: {
      sourceId: 'src:test',
      version: '1',
      kind: 'memory',
      name: 'fixture.mp4',
      size: 0,
      data: new Uint8Array(),
      metadata: {},
    },
    probe: {
      sourceId: 'src:test',
      format: 'mp4',
      confidence: 1,
      candidates: [],
      diagnostics: [],
    },
    container: { format: 'mp4', longName: 'ISO BMFF', metadata: {} },
    tracks: [videoTrack],
    samples,
    diagnostics: [],
    metadata: {},
    analyzedAt: new Date(0).toISOString(),
    analysisDurationMs: 0,
  };

  return {
    selectionId: 'sel:test',
    criteria: {
      startIndex: 0,
      startTimeUs: 0,
      frameType: 'all',
      order: 'presentation',
    },
    selectedTrack: {
      selectedTrackId: 'src:test:1:mp4:video:0',
      asset,
      track: videoTrack,
      samples,
      diagnostics: [],
    },
    samples,
    rangeStartUs: 0,
    diagnostics: [],
  };
}

describe('buildEncodedTrackFromSelection', () => {
  it('materializes packets in DTS order with decoderConfig', () => {
    // Presentation order B then P, but DTS has P before B.
    const samples = [
      sample(0, 0, 0, true),
      sample(1, 66_666, 33_333, false),
      sample(2, 33_333, 66_666, false),
    ];
    const track = buildEncodedTrackFromSelection(selectionFromSamples(samples));

    expect(track.kind).toBe('video');
    expect(track.decoderConfig.codec).toBe('avc1.42001e');
    expect(track.packets).toHaveLength(3);
    expect(track.packets.map(packet => packet.dtsUs)).toEqual([0, 33_333, 66_666]);
    expect(track.metadata.packetCount).toBe(3);
    expect(track.metadata.width).toBe(640);
  });
});

describe('decodedWindowCapacity / StreamingVideoDecoder clock helpers', () => {
  it('maps capacitySeconds × fps to a bounded frame window', () => {
    expect(decodedWindowCapacity(2, 30)).toBe(60);
    expect(decodedWindowCapacity(0.01, 60)).toBe(4);
  });

  it('reports first/last pts from setPackets', () => {
    const decoder = new StreamingVideoDecoder({
      decoderConfig: videoTrack.decoderConfig!,
      capacityFrames: 4,
      lookaheadUs: 66_666,
    });
    decoder.setPackets(
      buildEncodedTrackFromSelection(
        selectionFromSamples([
          sample(0, 10_000, 0, true),
          sample(1, 40_000, 33_333, false),
          sample(2, 70_000, 66_666, false),
        ]),
      ).packets,
    );

    expect(decoder.packetCount()).toBe(3);
    expect(decoder.firstPtsUs()).toBe(10_000);
    expect(decoder.lastPtsUs()).toBe(70_000);
    expect(decoder.decodedCount()).toBe(0);
  });
});
