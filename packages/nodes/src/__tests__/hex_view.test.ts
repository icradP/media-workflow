import { describe, expect, it } from 'vitest';
import {
  createContext,
  type ByteData,
  type MediaAsset,
  type MediaSource,
} from '@media-workflow/core';
import { extractByteView, hexViewNode } from '../display/hex_view.js';

const source: MediaSource = {
  sourceId: 'source',
  version: '1',
  kind: 'memory',
  name: 'bytes.bin',
  size: 6,
  data: Uint8Array.of(0, 1, 2, 3, 4, 5),
  metadata: {},
};

describe('Hex View byte adapters', () => {
  it('reads MediaSource, BufferData, and MediaAsset bytes', () => {
    expect(extractByteView(source).data).toEqual(source.data);
    expect(extractByteView({
      data: Uint8Array.of(7, 8, 9),
      byteOffset: 100,
      byteLength: 2,
    })).toMatchObject({
      data: Uint8Array.of(7, 8),
      baseOffset: 100,
    });
    expect(extractByteView({
      source,
    } as MediaAsset)).toMatchObject({
      data: source.data,
      sourceType: 'MediaAsset.source',
    });
  });

  it('flattens video planes and NAL units', () => {
    const video = extractByteView({
      width: 1,
      height: 1,
      format: 'I420',
      planes: [Uint8Array.of(1, 2), Uint8Array.of(3), Uint8Array.of(4)],
      strides: [1, 1, 1],
      pts: 0,
      close() {},
    });
    expect(video.data).toEqual(Uint8Array.of(1, 2, 3, 4));

    const nal = extractByteView({
      codec: 'h264',
      units: [
        { type: 7, typeName: 'SPS', data: Uint8Array.of(0x67, 1), offset: 20, totalSize: 2 },
        { type: 8, typeName: 'PPS', data: Uint8Array.of(0x68, 2), offset: 22, totalSize: 2 },
      ],
    });
    expect(nal.data).toEqual(Uint8Array.of(0x67, 1, 0x68, 2));
    expect(nal.baseOffset).toBe(20);
  });

  it('views the underlying bytes of typed audio buffers', () => {
    const audio = extractByteView({
      sampleRate: 48_000,
      channels: 1,
      format: 's16',
      data: new Int16Array([0x0102, 0x0304]),
      sampleCount: 2,
      pts: 0,
      duration: 0,
    });
    expect(audio.data.byteLength).toBe(4);
  });

  it('concatenates encoded bytes from Frame Selector samples', () => {
    const selectedFrames = extractByteView([
      {
        sampleId: 'one',
        index: 0,
        trackId: 'video',
        ptsUs: 0,
        dtsUs: 0,
        offset: 120,
        size: 2,
        isKey: true,
        data: Uint8Array.of(0x65, 0x01),
        metadata: {},
      },
      {
        sampleId: 'two',
        index: 1,
        trackId: 'video',
        ptsUs: 40_000,
        dtsUs: 40_000,
        offset: 122,
        size: 2,
        isKey: false,
        data: Uint8Array.of(0x41, 0x02),
        metadata: {},
      },
    ]);
    expect(selectedFrames.data).toEqual(Uint8Array.of(0x65, 0x01, 0x41, 0x02));
    expect(selectedFrames.baseOffset).toBe(120);
    expect(selectedFrames.sourceType).toBe('MediaSample[2]');
  });

  it('applies offset and length parameters to any byte input', async () => {
    const result = await hexViewNode.execute(
      createContext(new AbortController().signal),
      {
        inputs: { bytes: source as ByteData },
        params: { offset: 2, length: 3 },
      },
    );
    expect(JSON.parse(result.preview)).toMatchObject({
      offset: 2,
      byteLength: 3,
      hex: '02 03 04',
    });
  });
});
