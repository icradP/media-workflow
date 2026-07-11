import type { DecodedVideoFrame, DecodedVideoPixelFormat } from '@media-workflow/core';

export function copyVideoFrameToI420(
  frame: VideoFrame,
  sourceSampleId: string,
): DecodedVideoFrame {
  const format: DecodedVideoPixelFormat = 'I420';
  const width = frame.displayWidth;
  const height = frame.displayHeight;
  const ySize = width * height;
  const uvWidth = Math.ceil(width / 2);
  const uvHeight = Math.ceil(height / 2);
  const uvSize = uvWidth * uvHeight;
  const packed = new Uint8Array(ySize + uvSize * 2);

  frame.copyTo(packed, { format: 'I420' });
  const yPlane = packed.slice(0, ySize);
  const uPlane = packed.slice(ySize, ySize + uvSize);
  const vPlane = packed.slice(ySize + uvSize, ySize + uvSize * 2);

  return {
    frameId: `${sourceSampleId}:decoded`,
    sourceSampleId,
    ptsUs: Math.round(frame.timestamp * 1_000),
    durationUs: undefined,
    codedWidth: frame.codedWidth,
    codedHeight: frame.codedHeight,
    displayWidth: width,
    displayHeight: height,
    format,
    planes: [yPlane, uPlane, vPlane],
    strides: [width, uvWidth, uvWidth],
    colorSpace: {
      primaries: frame.colorSpace?.primaries ?? undefined,
      transfer: frame.colorSpace?.transfer ?? undefined,
      matrix: frame.colorSpace?.matrix ?? undefined,
      fullRange: frame.colorSpace?.fullRange ?? undefined,
    },
    metadata: {},
  };
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

export function isWebCodecsAvailable(): boolean {
  return typeof globalThis.VideoDecoder !== 'undefined' &&
    typeof globalThis.VideoFrame !== 'undefined';
}

export function isWebCodecsAudioAvailable(): boolean {
  return typeof globalThis.AudioDecoder !== 'undefined' &&
    typeof globalThis.AudioData !== 'undefined';
}
