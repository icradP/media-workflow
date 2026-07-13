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

  it('reads decoded clips, PCM clips, tracks, and encoded packets', () => {
    expect(extractByteView({
      requestId: 'req-1',
      backend: {
        id: 'mock',
        version: '1',
        api: 'mock',
        codecFamilies: ['h264'],
        inputFormats: ['annexb'],
        outputFormats: ['I420'],
      },
      frames: [{
        frameId: 'f0',
        sourceSampleId: 's0',
        ptsUs: 0,
        codedWidth: 1,
        codedHeight: 1,
        displayWidth: 1,
        displayHeight: 1,
        format: 'I420',
        planes: [Uint8Array.of(1, 2), Uint8Array.of(3)],
        strides: [1, 1],
        metadata: {},
      }],
      diagnostics: [],
    }).data).toEqual(Uint8Array.of(1, 2, 3));

    expect(extractByteView({
      clipId: 'pcm-1',
      sourceTrackId: 'audio',
      ptsUs: 0,
      durationUs: 1,
      sampleRate: 48_000,
      channels: 1,
      sampleCount: 1,
      format: 'f32-planar',
      planes: [new Float32Array([1.25])],
      backend: {
        id: 'mock',
        version: '1',
        api: 'mock',
        codecFamilies: ['pcm'],
        inputFormats: ['unknown'],
        outputFormats: ['f32-planar'],
      },
      diagnostics: [],
    }).sourceType).toBe('PcmAudioClip.f32-planar');

    expect(extractByteView({
      selectedTrackId: 'asset:video:0',
      asset: { source } as MediaAsset,
      track: {
        trackId: 'video',
        index: 0,
        kind: 'video',
        codec: 'H.264',
        codecFamily: 'h264',
        codecConfig: null,
        sampleCount: 1,
        metadata: {},
      },
      samples: [{
        sampleId: 'one',
        index: 0,
        trackId: 'video',
        ptsUs: 0,
        dtsUs: 0,
        offset: 10,
        size: 2,
        isKey: true,
        data: Uint8Array.of(0x65, 0x01),
        metadata: {},
      }],
      diagnostics: [],
    }).data).toEqual(Uint8Array.of(0x65, 0x01));

    expect(extractByteView([{
      packetId: 'p0',
      sourceSampleId: 's0',
      trackId: 'video',
      codecFamily: 'h264',
      bitstreamFormat: 'annexb',
      data: Uint8Array.of(0, 0, 1, 0x65),
      ptsUs: 0,
      dtsUs: 0,
      isKey: true,
      metadata: {},
    }]).sourceType).toBe('EncodedPacket[1]');
  });
});
