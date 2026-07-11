import { describe, expect, it } from 'vitest';
import type { MediaSample, VideoMediaTrack } from '@media-workflow/core';
import { planVideoDecodeRequest } from '../planner/video.js';
import { planAudioDecodeRequest, trimPcmToRange } from '../planner/audio.js';

const videoTrack: VideoMediaTrack = {
  trackId: 'mp4:video:0',
  index: 0,
  kind: 'video',
  codec: 'H.264',
  codecFamily: 'h264',
  codecConfig: new Uint8Array([1, 0x42, 0, 0x1e, 0xff, 0xe1, 0, 4, 0x67, 0, 0, 0]),
  sampleCount: 6,
  metadata: {},
  width: 640,
  height: 360,
  decoderConfig: {
    codec: 'avc1.42001e',
    codecFamily: 'h264',
    description: new Uint8Array([1, 0x42, 0, 0x1e, 0xff, 0xe1, 0, 4, 0x67, 0, 0, 0]),
    bitstreamFormat: 'avcc',
    codedWidth: 640,
    codedHeight: 360,
    metadata: {},
  },
};

function sample(
  index: number,
  ptsUs: number,
  dtsUs: number,
  isKey: boolean,
): MediaSample {
  return {
    sampleId: `${videoTrack.trackId}:${index}`,
    index,
    trackId: videoTrack.trackId,
    ptsUs,
    dtsUs,
    durationUs: 33_000,
    offset: index * 100,
    size: 100,
    isKey,
    data: new Uint8Array([0, 0, 0, 1, isKey ? 0x65 : 0x41]),
    metadata: {},
  };
}

describe('video decode planner', () => {
  const samples = [
    sample(0, 0, 0, true),
    sample(1, 33_000, 33_000, false),
    sample(2, 66_000, 66_000, false),
    sample(3, 99_000, 99_000, true),
    sample(4, 132_000, 132_000, false),
    sample(5, 165_000, 165_000, false),
  ];

  it('includes GOP dependencies for a non-key target frame', () => {
    const request = planVideoDecodeRequest({
      requestId: 'req-1',
      track: videoTrack,
      decoderConfig: videoTrack.decoderConfig!,
      samples,
      containerFormat: 'mp4',
      selection: { sampleIndexes: [2] },
    });

    expect(request.targetSampleIds).toEqual([samples[2]!.sampleId]);
    expect(request.decodePackets.map(packet => packet.sourceSampleId)).toEqual([
      samples[0]!.sampleId,
      samples[1]!.sampleId,
      samples[2]!.sampleId,
    ]);
  });

  it('spans GOP boundaries when targets cross keyframes', () => {
    const request = planVideoDecodeRequest({
      requestId: 'req-2',
      track: videoTrack,
      decoderConfig: videoTrack.decoderConfig!,
      samples,
      containerFormat: 'mp4',
      selection: { sampleIndexes: [2, 5] },
    });

    expect(request.decodePackets.map(packet => packet.sourceSampleId)).toEqual([
      samples[0]!.sampleId,
      samples[1]!.sampleId,
      samples[2]!.sampleId,
      samples[3]!.sampleId,
      samples[4]!.sampleId,
      samples[5]!.sampleId,
    ]);
  });

  it('warns when no preceding keyframe exists', () => {
    const orphanSamples = [
      sample(0, 0, 0, false),
      sample(1, 33_000, 33_000, false),
    ];
    const request = planVideoDecodeRequest({
      requestId: 'req-3',
      track: videoTrack,
      decoderConfig: videoTrack.decoderConfig!,
      samples: orphanSamples,
      containerFormat: 'mp4',
      selection: { sampleIndexes: [1] },
    });

    expect(request.diagnostics.some(item => item.code === 'video_request.no_preceding_keyframe')).toBe(true);
    expect(request.decodePackets).toHaveLength(2);
  });
});

describe('audio decode planner', () => {
  const audioTrack = {
    trackId: 'mp4:audio:1',
    index: 1,
    kind: 'audio' as const,
    codec: 'AAC',
    codecFamily: 'aac' as const,
    codecConfig: new Uint8Array([0x12, 0x10]),
    sampleCount: 3,
    metadata: {},
    sampleRate: 48_000,
    channels: 2,
    decoderConfig: {
      codec: 'mp4a.40.2',
      codecFamily: 'aac' as const,
      description: new Uint8Array([0x12, 0x10]),
      bitstreamFormat: 'aac_raw' as const,
      sampleRate: 48_000,
      channels: 2,
      metadata: {},
    },
  };

  const audioSamples: MediaSample[] = [
    {
      sampleId: 'mp4:audio:1:0',
      index: 0,
      trackId: audioTrack.trackId,
      ptsUs: 0,
      dtsUs: 0,
      durationUs: 21_333,
      offset: 0,
      size: 200,
      isKey: true,
      data: new Uint8Array(200),
      metadata: {},
    },
    {
      sampleId: 'mp4:audio:1:1',
      index: 1,
      trackId: audioTrack.trackId,
      ptsUs: 21_333,
      dtsUs: 21_333,
      durationUs: 21_333,
      offset: 200,
      size: 200,
      isKey: false,
      data: new Uint8Array(200),
      metadata: {},
    },
    {
      sampleId: 'mp4:audio:1:2',
      index: 2,
      trackId: audioTrack.trackId,
      ptsUs: 42_666,
      dtsUs: 42_666,
      durationUs: 21_334,
      offset: 400,
      size: 200,
      isKey: false,
      data: new Uint8Array(200),
      metadata: {},
    },
  ];

  it('selects overlapping packets for a half-open range', () => {
    const request = planAudioDecodeRequest({
      requestId: 'audio-1',
      track: audioTrack,
      decoderConfig: audioTrack.decoderConfig,
      samples: audioSamples,
      rangeStartUs: 10_000,
      rangeEndUs: 30_000,
      containerFormat: 'mp4',
    });

    expect(request.decodePackets).toHaveLength(2);
    expect(request.rangeStartUs).toBe(10_000);
    expect(request.rangeEndUs).toBe(30_000);
  });

  it('trims PCM to sample boundaries', () => {
    const planes = [
      new Float32Array([0, 0.25, 0.5, 0.75, 1]),
      new Float32Array([0, 0.1, 0.2, 0.3, 0.4]),
    ];
    const trimmed = trimPcmToRange({
      planes,
      sampleRate: 4,
      channels: 2,
      ptsUs: 0,
      rangeStartUs: 500_000,
      rangeEndUs: 1_000_000,
    });

    expect(trimmed.sampleCount).toBe(2);
    expect(trimmed.planes[0]).toEqual(new Float32Array([0.5, 0.75]));
  });
});
