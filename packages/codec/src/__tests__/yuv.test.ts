import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  nv12ToI420Planes,
  packI420Planes,
  parseI420Buffer,
  resolveVideoFrameSampleId,
  videoFrameBufferToI420Planes,
} from '../decode/yuv.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const decodeFixturesDir = join(root, 'tests', 'fixtures', 'decode');

interface DecodeVideoBaseline {
  available: boolean;
  width: number | null;
  height: number | null;
  byteLength: number;
  sha256: string;
  outputFile: string;
  error?: string;
}

interface DecodeBaselineRecord {
  input: { file: string; size: number; sha256: string };
  video: DecodeVideoBaseline;
}

describe('I420 decode helpers', () => {
  it('converts NV12 interleaved chroma into planar I420', () => {
    const width = 4;
    const height = 4;
    const ySize = width * height;
    const uvWidth = width / 2;
    const uvHeight = height / 2;
    const buffer = new Uint8Array(ySize + width * uvHeight);
    buffer.fill(16, 0, ySize);
    for (let row = 0; row < uvHeight; row++) {
      for (let col = 0; col < uvWidth; col++) {
        const offset = ySize + row * width + col * 2;
        buffer[offset] = 80 + col;
        buffer[offset + 1] = 160 + row;
      }
    }

    const [yPlane, uPlane, vPlane] = nv12ToI420Planes(
      buffer,
      { offset: 0, stride: width },
      { offset: ySize, stride: width },
      width,
      height,
    );

    expect(yPlane.byteLength).toBe(ySize);
    expect(uPlane).toEqual(new Uint8Array([80, 81, 80, 81]));
    expect(vPlane).toEqual(new Uint8Array([160, 160, 161, 161]));

    const packed = packI420Planes({
      frameId: 'test',
      sourceSampleId: 'test',
      ptsUs: 0,
      codedWidth: width,
      codedHeight: height,
      displayWidth: width,
      displayHeight: height,
      format: 'I420',
      planes: [yPlane, uPlane, vPlane],
      strides: [width, uvWidth, uvWidth],
      metadata: {},
    });
    expect(packed.byteLength).toBe(ySize + uvWidth * uvHeight * 2);
  });

  it('converts native VideoFrame NV12 copy layout without explicit format conversion', () => {
    const width = 4;
    const height = 4;
    const ySize = width * height;
    const buffer = new Uint8Array(ySize + width * (height / 2));
    buffer.fill(32, 0, ySize);
    buffer.set([90, 140, 91, 141, 92, 142, 93, 143], ySize);

    const [yPlane, uPlane, vPlane] = videoFrameBufferToI420Planes(
      buffer,
      [
        { offset: 0, stride: width },
        { offset: ySize, stride: width },
      ],
      'NV12',
      width,
      height,
    );

    expect(yPlane).toEqual(new Uint8Array(ySize).fill(32));
    expect(uPlane).toEqual(new Uint8Array([90, 91, 92, 93]));
    expect(vPlane).toEqual(new Uint8Array([140, 141, 142, 143]));
  });

  it('round-trips ffmpeg yuv420p fixtures through packI420Planes', () => {
    const record = readBaseline('generated-av.mp4.decode.json');
    if (!record.video.available) return;

    const yuvBytes = readFileSync(join(root, record.video.outputFile));
    expect(yuvBytes.byteLength).toBe(record.video.byteLength);
    expect(createHash('sha256').update(yuvBytes).digest('hex')).toBe(record.video.sha256);

    const frame = parseI420Buffer(
      yuvBytes,
      record.video.width!,
      record.video.height!,
    );
    const packed = packI420Planes(frame);
    expect(packed.byteLength).toBe(record.video.byteLength);
    expect(createHash('sha256').update(packed).digest('hex')).toBe(record.video.sha256);
  });

  it('resolves decoder timestamps with small drift', () => {
    const ptsToSampleId = new Map<number, string>([
      [737_399_000, 'flv:video:video:42'],
    ]);
    const targetSampleIds = new Set(['flv:video:video:42']);

    expect(resolveVideoFrameSampleId(737_399_000, ptsToSampleId, targetSampleIds))
      .toBe('flv:video:video:42');
    expect(resolveVideoFrameSampleId(737_399_500, ptsToSampleId, targetSampleIds))
      .toBe('flv:video:video:42');
    expect(resolveVideoFrameSampleId(737_410_000, ptsToSampleId, targetSampleIds))
      .toBe('');
  });
});

function readBaseline(fileName: string): DecodeBaselineRecord {
  return JSON.parse(
    readFileSync(join(decodeFixturesDir, fileName), 'utf8'),
  ) as DecodeBaselineRecord;
}
