import { isMp4OrFmp4Signature } from '../detect.js';

export interface Mp4Metadata {
  durationMs: number;
  trackCount: number;
  videoTrackCount: number;
  audioTrackCount: number;
}

export function parseMp4Metadata(data: Uint8Array): Mp4Metadata | null {
  if (!isMp4OrFmp4Signature(data)) return null;

  let offset = 0;
  let durationMs = 0;
  let trackCount = 0;
  let videoTrackCount = 0;
  let audioTrackCount = 0;

  while (offset + 8 <= data.byteLength) {
    const view = new DataView(data.buffer, data.byteOffset + offset);
    let size = view.getUint32(0);
    const type = String.fromCharCode(
      view.getUint8(4)!,
      view.getUint8(5)!,
      view.getUint8(6)!,
      view.getUint8(7)!,
    );
    let headerSize = 8;
    if (size === 1 && offset + 16 <= data.byteLength) {
      const hi = view.getUint32(8);
      const lo = view.getUint32(12);
      size = hi * 0x100000000 + lo;
      headerSize = 16;
    } else if (size === 0) {
      size = data.byteLength - offset;
    }
    if (size < headerSize || offset + size > data.byteLength) break;

    if (type === 'moov') {
      const moov = data.subarray(offset + headerSize, offset + size);
      const parsed = parseMoov(moov);
      durationMs = Math.max(durationMs, parsed.durationMs);
      trackCount += parsed.trackCount;
      videoTrackCount += parsed.videoTrackCount;
      audioTrackCount += parsed.audioTrackCount;
    }

    offset += size;
  }

  if (trackCount === 0 && durationMs <= 0) return null;
  return {
    durationMs: Math.max(0, durationMs),
    trackCount,
    videoTrackCount,
    audioTrackCount,
  };
}

function parseMoov(data: Uint8Array): Mp4Metadata {
  let offset = 0;
  let durationMs = 0;
  let trackCount = 0;
  let videoTrackCount = 0;
  let audioTrackCount = 0;

  while (offset + 8 <= data.byteLength) {
    const view = new DataView(data.buffer, data.byteOffset + offset);
    const size = view.getUint32(0);
    const type = String.fromCharCode(
      view.getUint8(4)!,
      view.getUint8(5)!,
      view.getUint8(6)!,
      view.getUint8(7)!,
    );
    if (size < 8 || offset + size > data.byteLength) break;

    if (type === 'mvhd') {
      durationMs = Math.max(durationMs, parseMvhdDurationMs(data.subarray(offset, offset + size)));
    } else if (type === 'trak') {
      trackCount += 1;
      const handler = readTrackHandlerType(data.subarray(offset + 8, offset + size));
      if (handler === 'vide') videoTrackCount += 1;
      if (handler === 'soun') audioTrackCount += 1;
    }

    offset += size;
  }

  return {
    durationMs,
    trackCount,
    videoTrackCount,
    audioTrackCount,
  };
}

function parseMvhdDurationMs(mvhd: Uint8Array): number {
  if (mvhd.byteLength < 28) return 0;
  const view = new DataView(mvhd.buffer, mvhd.byteOffset, mvhd.byteLength);
  const version = view.getUint8(8);
  if (version === 0) {
    const timeScale = view.getUint32(20);
    const duration = view.getUint32(24);
    return timeScale > 0 ? (duration / timeScale) * 1000 : 0;
  }
  if (mvhd.byteLength < 40) return 0;
  const timeScale = view.getUint32(28);
  const hi = view.getUint32(32);
  const lo = view.getUint32(36);
  const duration = hi * 0x100000000 + lo;
  return timeScale > 0 ? (duration / timeScale) * 1000 : 0;
}

function readTrackHandlerType(trakBody: Uint8Array): string | null {
  let offset = 0;
  while (offset + 8 <= trakBody.byteLength) {
    const view = new DataView(trakBody.buffer, trakBody.byteOffset + offset);
    const size = view.getUint32(0);
    const type = String.fromCharCode(
      view.getUint8(4)!,
      view.getUint8(5)!,
      view.getUint8(6)!,
      view.getUint8(7)!,
    );
    if (size < 8 || offset + size > trakBody.byteLength) break;
    if (type === 'mdia') {
      return readHandlerTypeFromMdia(trakBody.subarray(offset + 8, offset + size));
    }
    offset += size;
  }
  return null;
}

function readHandlerTypeFromMdia(mdiaBody: Uint8Array): string | null {
  let offset = 0;
  while (offset + 8 <= mdiaBody.byteLength) {
    const view = new DataView(mdiaBody.buffer, mdiaBody.byteOffset + offset);
    const size = view.getUint32(0);
    const type = String.fromCharCode(
      view.getUint8(4)!,
      view.getUint8(5)!,
      view.getUint8(6)!,
      view.getUint8(7)!,
    );
    if (size < 8 || offset + size > mdiaBody.byteLength) break;
    if (type === 'hdlr' && offset + 20 <= mdiaBody.byteLength) {
      return String.fromCharCode(
        view.getUint8(16)!,
        view.getUint8(17)!,
        view.getUint8(18)!,
        view.getUint8(19)!,
      );
    }
    offset += size;
  }
  return null;
}
