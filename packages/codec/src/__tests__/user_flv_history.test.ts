import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  analyzeMediaSource,
  materializeMediaSelection,
  planAudioDecodeRequest,
  selectTrack,
} from '@media-workflow/codec';

const USER_FLV = '/Users/icrad/Documents/1_860112070481306.history.flv';

describe('user history FLV audio decode', () => {
  it('plans AAC decode for 8 kHz mono FLV audio selection', () => {
    let data: Uint8Array;
    try {
      data = new Uint8Array(readFileSync(USER_FLV));
    } catch {
      return;
    }

    const asset = analyzeMediaSource({
      sourceId: 'history-flv',
      version: 'test',
      kind: 'file',
      name: '1_860112070481306.history.flv',
      size: data.byteLength,
      data,
      metadata: {},
    });

    const audio = asset.tracks.find(track => track.kind === 'audio');
    expect(audio?.codecFamily).toBe('aac');
    expect(audio?.sampleRate).toBe(8000);
    expect(audio?.codecConfig?.byteLength).toBeGreaterThan(0);
    expect(audio?.decoderConfig?.bitstreamFormat).toBe('aac_raw');

    const selectedTrack = selectTrack(asset, { kind: 'audio', index: 0 });
    const selection = materializeMediaSelection(selectedTrack, {
      startTimeUs: 0,
      endTimeUs: 5_000_000,
      frameType: 'all',
      order: 'presentation',
    });
    expect(selection.samples.length).toBeGreaterThan(0);

    const rangeEndUs = selection.rangeEndUs ?? selection.samples.at(-1)!.ptsUs;
    const request = planAudioDecodeRequest({
      requestId: 'test',
      track: audio!,
      decoderConfig: audio!.decoderConfig!,
      samples: asset.samples,
      rangeStartUs: selection.rangeStartUs,
      rangeEndUs,
      containerFormat: 'flv',
    });
    expect(request.decodePackets.length).toBeGreaterThan(0);

    const first = request.decodePackets[0]!;
    expect(first.data.byteLength).toBeGreaterThan(0);
    expect(first.data[0]).not.toBe(0xff);
    expect(first.isKey).toBe(true);
    expect(first.durationUs).toBeGreaterThan(0);
    expect(request.decodePackets.every(packet => packet.isKey)).toBe(true);
  });
});
