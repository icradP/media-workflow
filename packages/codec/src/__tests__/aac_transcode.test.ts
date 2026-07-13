import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MediaSource } from '@media-workflow/core';
import { describe, expect, it } from 'vitest';
import {
  analyzeMediaSource,
  buildAacMediaSelection,
  encodePcmToAac,
  inferVideoCodecConfig,
  isWebCodecsAacEncoderAvailable,
  remuxMediaSelectionsToMp4,
} from '../index.js';
import { materializeMediaSelection, selectTrack } from '../planner/index.js';
import { decodeMp3SamplesToPcm, isWebAudioDecodeAvailable } from '../audio/mp3_decode.js';

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

describe('codec config inference', () => {
  it('infers H.264 avcC from in-band SPS/PPS NALUs', () => {
    const sps = new Uint8Array([0x67, 0x42, 0x00, 0x1f, 0xe1, 0x00, 0x00]);
    const pps = new Uint8Array([0x68, 0xce, 0x3c, 0x80]);
    const idr = new Uint8Array([0x65, 0x88, 0x84, 0x00]);
    const accessUnit = concatAvccNalus([sps, pps, idr]);

    const inferred = inferVideoCodecConfig(
      {
        trackId: 'video:0',
        index: 0,
        kind: 'video',
        codec: 'H.264',
        codecFamily: 'h264',
        codecConfig: null,
        sampleCount: 1,
        metadata: {},
      },
      [{
        sampleId: 'video:0:0',
        index: 0,
        trackId: 'video:0',
        ptsUs: 0,
        dtsUs: 0,
        durationUs: 33_000,
        offset: 0,
        size: accessUnit.byteLength,
        isKey: true,
        data: accessUnit,
        metadata: {},
      }],
    );
    expect(inferred?.byteLength).toBeGreaterThan(10);
  });
});

function concatAvccNalus(nalus: Uint8Array[]): Uint8Array {
  const total = nalus.reduce((sum, nalu) => sum + 4 + nalu.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const nalu of nalus) {
    const length = nalu.byteLength;
    out[offset] = (length >>> 24) & 0xff;
    out[offset + 1] = (length >>> 16) & 0xff;
    out[offset + 2] = (length >>> 8) & 0xff;
    out[offset + 3] = length & 0xff;
    out.set(nalu, offset + 4);
    offset += 4 + length;
  }
  return out;
}

describe('aac transcode helpers', () => {
  it('builds muxable AAC media selection from encoded packets', () => {
    const asset = loadAsset('tests/Duvet.mp3');
    const selectedTrack = selectTrack(asset, { kind: 'audio', index: 0 });
    const selection = materializeMediaSelection(selectedTrack);
    const encoded = {
      packets: [{
        data: new Uint8Array([0x01, 0x02]),
        ptsUs: 0,
        durationUs: 21_333,
        isKey: true,
      }],
      codecConfig: new Uint8Array([0x12, 0x10]),
      sampleRate: 44_100,
      channels: 2,
      codec: 'mp4a.40.2',
    };
    const aacSelection = buildAacMediaSelection(selection, encoded);
    expect(aacSelection.selectedTrack.track.codecFamily).toBe('aac');
    expect(aacSelection.selectedTrack.track.codecConfig?.byteLength).toBe(2);
    expect(aacSelection.samples).toHaveLength(1);

    const muxed = remuxMediaSelectionsToMp4({ audio: aacSelection });
    expect(muxed.audioSampleCount).toBe(1);
  });

  it('transcodes MP3 fixture to AAC when Web Audio and AudioEncoder are available', async () => {
    if (!isWebAudioDecodeAvailable() || !isWebCodecsAacEncoderAvailable()) {
      return;
    }

    const asset = loadAsset('tests/Duvet.mp3', 'source:mp3-transcode');
    const selectedTrack = selectTrack(asset, { kind: 'audio', index: 0 });
    const selection = materializeMediaSelection(selectedTrack, {
      endTimeUs: 2_000_000,
    });
    const pcm = await decodeMp3SamplesToPcm({
      samples: selection.samples,
      rangeStartUs: selection.rangeStartUs,
      rangeEndUs: selection.rangeEndUs ?? selection.rangeStartUs + 2_000_000,
      sourceTrackId: selectedTrack.track.trackId,
      requestId: 'mp3-transcode-test',
    });
    const encoded = await encodePcmToAac(pcm, { bitrate: 96_000 });
    const aacSelection = buildAacMediaSelection(selection, encoded);
    expect(aacSelection.samples.length).toBeGreaterThan(0);
    expect(aacSelection.selectedTrack.track.codecConfig?.byteLength).toBeGreaterThan(0);
  });
});
