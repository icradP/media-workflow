import type { DecodedVideoFrame, DecodedVideoPixelFormat } from '@media-workflow/core';

interface PlaneLayout {
  offset: number;
  stride: number;
}

type CopyPixelFormat = 'I420' | 'NV12';
type NativePixelFormat = CopyPixelFormat | string;

function extractPlane(
  buffer: Uint8Array,
  layout: PlaneLayout,
  width: number,
  height: number,
): Uint8Array {
  const plane = new Uint8Array(width * height);
  for (let row = 0; row < height; row++) {
    plane.set(
      buffer.subarray(layout.offset + row * layout.stride, layout.offset + row * layout.stride + width),
      row * width,
    );
  }
  return plane;
}

function isUnsupportedCopyFormatError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotSupportedError';
}

function videoFrameFormat(frame: VideoFrame): NativePixelFormat | undefined {
  return (frame as { format?: NativePixelFormat }).format;
}

async function copyNativeVideoFrame(
  frame: VideoFrame,
): Promise<{ buffer: Uint8Array; layout: PlaneLayout[]; format: NativePixelFormat | undefined }> {
  const allocationSize = frame.allocationSize();
  const buffer = new Uint8Array(allocationSize);
  const layout = await frame.copyTo(buffer);
  return { buffer, layout, format: videoFrameFormat(frame) };
}

function supportsExplicitCopyFormat(frame: VideoFrame, format: CopyPixelFormat): boolean {
  try {
    frame.allocationSize({ format });
    return true;
  } catch (error) {
    if (isUnsupportedCopyFormatError(error)) return false;
    throw error;
  }
}

async function copyVideoFrameWithExplicitFormat(
  frame: VideoFrame,
  format: CopyPixelFormat,
): Promise<{ buffer: Uint8Array; layout: PlaneLayout[] }> {
  const allocationSize = frame.allocationSize({ format });
  const buffer = new Uint8Array(allocationSize);
  const layout = await frame.copyTo(buffer, { format });
  return { buffer, layout };
}

function buildDecodedVideoFrame(
  frame: VideoFrame,
  sourceSampleId: string,
  planes: Uint8Array[],
  strides: [number, number, number],
  copyFormat: string,
): DecodedVideoFrame {
  const format: DecodedVideoPixelFormat = 'I420';
  return {
    frameId: `${sourceSampleId}:decoded`,
    sourceSampleId,
    ptsUs: Math.round(frame.timestamp),
    durationUs: undefined,
    codedWidth: frame.codedWidth,
    codedHeight: frame.codedHeight,
    displayWidth: frame.displayWidth,
    displayHeight: frame.displayHeight,
    format,
    planes,
    strides,
    colorSpace: {
      primaries: frame.colorSpace?.primaries ?? undefined,
      transfer: frame.colorSpace?.transfer ?? undefined,
      matrix: frame.colorSpace?.matrix ?? undefined,
      fullRange: frame.colorSpace?.fullRange ?? undefined,
    },
    metadata: {
      copyFormat,
    },
  };
}

export function nv12ToI420Planes(
  buffer: Uint8Array,
  yLayout: PlaneLayout,
  uvLayout: PlaneLayout,
  displayWidth: number,
  displayHeight: number,
): [Uint8Array, Uint8Array, Uint8Array] {
  const uvWidth = Math.ceil(displayWidth / 2);
  const uvHeight = Math.ceil(displayHeight / 2);
  const yPlane = extractPlane(buffer, yLayout, displayWidth, displayHeight);
  const uPlane = new Uint8Array(uvWidth * uvHeight);
  const vPlane = new Uint8Array(uvWidth * uvHeight);

  for (let row = 0; row < uvHeight; row++) {
    const uvRowStart = uvLayout.offset + row * uvLayout.stride;
    for (let col = 0; col < uvWidth; col++) {
      const index = row * uvWidth + col;
      uPlane[index] = buffer[uvRowStart + col * 2]!;
      vPlane[index] = buffer[uvRowStart + col * 2 + 1]!;
    }
  }

  return [yPlane, uPlane, vPlane];
}

export function videoFrameBufferToI420Planes(
  buffer: Uint8Array,
  layout: PlaneLayout[],
  pixelFormat: NativePixelFormat | undefined,
  displayWidth: number,
  displayHeight: number,
): [Uint8Array, Uint8Array, Uint8Array] {
  const normalizedFormat = String(pixelFormat ?? '').toUpperCase();
  const uvWidth = Math.ceil(displayWidth / 2);
  const uvHeight = Math.ceil(displayHeight / 2);

  if (normalizedFormat === 'I420' || layout.length >= 3) {
    const [yLayout, uLayout, vLayout] = layout;
    if (!yLayout || !uLayout || !vLayout) {
      throw new Error('copyVideoFrameToI420: I420 plane layout is incomplete');
    }
    return [
      extractPlane(buffer, yLayout, displayWidth, displayHeight),
      extractPlane(buffer, uLayout, uvWidth, uvHeight),
      extractPlane(buffer, vLayout, uvWidth, uvHeight),
    ];
  }

  if (normalizedFormat === 'NV12' || layout.length === 2) {
    const [yLayout, uvLayout] = layout;
    if (!yLayout || !uvLayout) {
      throw new Error('copyVideoFrameToI420: NV12 plane layout is incomplete');
    }
    return nv12ToI420Planes(buffer, yLayout, uvLayout, displayWidth, displayHeight);
  }

  throw new Error(
    `copyVideoFrameToI420: unsupported native VideoFrame format ${String(pixelFormat ?? 'unknown')}`,
  );
}

export async function copyVideoFrameToI420(
  frame: VideoFrame,
  sourceSampleId: string,
): Promise<DecodedVideoFrame> {
  const displayWidth = frame.displayWidth;
  const displayHeight = frame.displayHeight;
  const uvWidth = Math.ceil(displayWidth / 2);
  const nativeFormat = videoFrameFormat(frame);

  try {
    const { buffer, layout, format } = await copyNativeVideoFrame(frame);
    const planes = videoFrameBufferToI420Planes(
      buffer,
      layout,
      format,
      displayWidth,
      displayHeight,
    );
    return buildDecodedVideoFrame(
      frame,
      sourceSampleId,
      planes,
      [displayWidth, uvWidth, uvWidth],
      String(format ?? 'native'),
    );
  } catch (error) {
    if (!isUnsupportedCopyFormatError(error)) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('unsupported native VideoFrame format')) throw error;
    }
  }

  const preferredFormats: CopyPixelFormat[] = nativeFormat === 'NV12'
    ? ['NV12', 'I420']
    : ['I420', 'NV12'];

  let lastError: unknown;
  for (const format of preferredFormats) {
    if (!supportsExplicitCopyFormat(frame, format)) continue;

    try {
      const { buffer, layout } = await copyVideoFrameWithExplicitFormat(frame, format);
      const planes = videoFrameBufferToI420Planes(
        buffer,
        layout,
        format,
        displayWidth,
        displayHeight,
      );
      return buildDecodedVideoFrame(
        frame,
        sourceSampleId,
        planes,
        [displayWidth, uvWidth, uvWidth],
        format,
      );
    } catch (error) {
      if (isUnsupportedCopyFormatError(error)) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('copyVideoFrameToI420: no supported VideoFrame copy format (I420/NV12)');
}

export function packI420Planes(frame: DecodedVideoFrame): Uint8Array {
  const [y, u, v] = frame.planes;
  const result = new Uint8Array(
    (y?.byteLength ?? 0) + (u?.byteLength ?? 0) + (v?.byteLength ?? 0),
  );
  let offset = 0;
  for (const plane of [y, u, v]) {
    if (!plane) continue;
    result.set(plane, offset);
    offset += plane.byteLength;
  }
  return result;
}

export function parseI420Buffer(
  data: Uint8Array,
  width: number,
  height: number,
): DecodedVideoFrame {
  const uvWidth = Math.ceil(width / 2);
  const uvHeight = Math.ceil(height / 2);
  const ySize = width * height;
  const uvSize = uvWidth * uvHeight;
  const expected = ySize + uvSize * 2;
  if (data.byteLength !== expected) {
    throw new Error(`I420 buffer size mismatch: expected ${expected}, got ${data.byteLength}`);
  }

  return {
    frameId: 'fixture:i420',
    sourceSampleId: 'fixture:i420',
    ptsUs: 0,
    codedWidth: width,
    codedHeight: height,
    displayWidth: width,
    displayHeight: height,
    format: 'I420',
    planes: [
      data.subarray(0, ySize),
      data.subarray(ySize, ySize + uvSize),
      data.subarray(ySize + uvSize, expected),
    ],
    strides: [width, uvWidth, uvWidth],
    metadata: {},
  };
}

export function resolveVideoFrameSampleId(
  timestampUs: number,
  ptsToSampleId: ReadonlyMap<number, string>,
  targetSampleIds: ReadonlySet<string>,
): string {
  const rounded = Math.round(timestampUs);
  const direct = ptsToSampleId.get(rounded);
  if (direct && targetSampleIds.has(direct)) return direct;

  let bestId = '';
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [ptsUs, sampleId] of ptsToSampleId) {
    if (!targetSampleIds.has(sampleId)) continue;
    const distance = Math.abs(ptsUs - rounded);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestId = sampleId;
    }
  }

  return bestDistance <= 5_000 ? bestId : '';
}

export function isWebCodecsAvailable(): boolean {
  return typeof globalThis.VideoDecoder !== 'undefined' &&
    typeof globalThis.VideoFrame !== 'undefined';
}

export function isWebCodecsAudioAvailable(): boolean {
  return typeof globalThis.AudioDecoder !== 'undefined' &&
    typeof globalThis.AudioData !== 'undefined';
}
