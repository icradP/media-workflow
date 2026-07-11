/**
 * MPEG-PS (Program Stream) parser.
 *
 * PS packs contain PES packets with MPEG-1/2 video + audio elementary streams.
 * This implementation extracts PES headers and elementary stream data.
 */

import { BitReader } from '../binary/reader.js';
import type { MediaAnalysisResult, StreamInfo, FrameInfo, MediaFormat } from '@media-workflow/core';
import { parseH264SpsNaluPayload } from '../h264/sps.js';
import { parseHevcSpsNaluPayload } from '../h265/sps.js';
import { splitAnnexBNalus } from '../nalu/annexb.js';

// PS pack start code
const PACK_START_CODE = 0x000001BA;
const SYSTEM_HEADER_START = 0x000001BB;
const PES_START_PREFIX = 0x000001;

function findStartCode(data: Uint8Array, offset: number, code: number): number {
  for (let i = offset; i + 4 <= data.length; i++) {
    const val = (data[i]! << 24) | (data[i + 1]! << 16) | (data[i + 2]! << 8) | data[i + 3]!;
    if (val === code) return i;
  }
  return -1;
}

function parsePesPacket(data: Uint8Array, _offset: number): { streamId: number; pts: number | null; dts: number | null; esData: Uint8Array; size: number } | null {
  if (data.length < 9) return null;
  const reader = new BitReader(data, 0);
  const prefix = reader.readBits(24);
  if (prefix !== 1) return null;
  const streamId = reader.readBits(8);
  const pesLen = reader.readBits(16);

  // Skip PES header flags
  reader.readBits(2 + 2 + 1 + 1 + 1 + 1);
  const ptsDtsFlags = reader.readBits(2);
  reader.readBits(1 + 1 + 1 + 1 + 1 + 1);
  const headerLen = reader.readBits(8);

  let pts: number | null = null, dts: number | null = null;
  const headerEnd = 9 + headerLen;
  if ((ptsDtsFlags & 2) && data.length >= 14) {
    const p = new BitReader(data, 9);
    p.readBits(4);
    const pts32to30 = p.readBits(3);
    p.readBits(1);
    const pts29to15 = p.readBits(15);
    p.readBits(1);
    const pts14to0 = p.readBits(15);
    pts = (pts32to30 * 2 ** 30 + pts29to15 * 2 ** 15 + pts14to0) / 90;
  }

  const esDataOffset = Math.min(headerEnd, data.length);
  const esData = new Uint8Array(data.buffer, data.byteOffset + esDataOffset, data.length - esDataOffset);
  return { streamId, pts, dts, esData, size: data.length };
}

export function parseMpegPsForAnalysis(fileBytes: Uint8Array): MediaAnalysisResult {
  const frames: FrameInfo[] = [];
  let hasVideo = false, hasAudio = false;
  let spsInfo: Record<string, unknown> | null = null;
  let frameIdx = 0;

  // Find first pack header
  let offset = findStartCode(fileBytes, 0, PACK_START_CODE);
  if (offset < 0) {
    return { format: { container: 'mpegps', subtype: 'mpegps', details: {} }, streams: [], frames: [], formatSpecific: {} };
  }

  while (offset < fileBytes.length - 8) {
    // Find next start code
    const nextPack = findStartCode(fileBytes, offset + 4, PACK_START_CODE);
    const nextSystem = findStartCode(fileBytes, offset + 4, SYSTEM_HEADER_START);
    let nextPes = findStartCode(fileBytes, offset + 4, PES_START_PREFIX);

    // Skip if it's a pack or system header
    if (nextPes >= 0) {
      const streamId = fileBytes[nextPes + 3]!;
      if (streamId >= 0xBC && streamId <= 0xFF) {
        // Private/system stream — skip
        offset = nextPes;
        continue;
      }

      // Determine end of this PES
      let end = fileBytes.length;
      const candidates = [nextPack, nextSystem].filter(x => x > nextPes);
      // Find next PES start code after this one
      for (let i = nextPes + 4; i + 4 <= fileBytes.length; i++) {
        const val = (fileBytes[i]! << 24) | (fileBytes[i + 1]! << 16) | (fileBytes[i + 2]! << 8) | fileBytes[i + 3]!;
        if (val === PES_START_PREFIX && i > nextPes) { candidates.push(i); break; }
        if (val === PACK_START_CODE && i > nextPes) { candidates.push(i); break; }
      }
      end = Math.min(...candidates.filter(x => x > 0));

      if (end > nextPes) {
        const pesData = fileBytes.slice(nextPes, end);
        const pes = parsePesPacket(pesData, nextPes);
        if (pes) {
          if ((pes.streamId >= 0xE0 && pes.streamId <= 0xEF) || pes.streamId === 0xFD) {
            hasVideo = true;
            // Try SPS extraction
            if (!spsInfo && pes.esData.length > 4) {
              const nalus = splitAnnexBNalus(pes.esData);
              for (const nalu of nalus) {
                if (nalu.length > 1 && (nalu[0]! & 0x1f) === 7) {
                  const sps = parseH264SpsNaluPayload(nalu);
                  if (sps._actualWidth) spsInfo = sps;
                }
              }
            }
          } else if (pes.streamId >= 0xC0 && pes.streamId <= 0xDF) {
            hasAudio = true;
          }

          frames.push({
            index: frameIdx++,
            streamIndex: (pes.streamId >= 0xE0 && pes.streamId <= 0xEF) ? 0 : 1,
            kind: (pes.streamId >= 0xC0 && pes.streamId <= 0xDF) ? 'audio' : 'video',
            dts: pes.pts ?? frameIdx * 40,
            pts: pes.pts ?? frameIdx * 40,
            offset: nextPes,
            size: end - nextPes,
            isKey: false,
            rawData: pes.esData,
            dataOrigin: 'demuxed_payload',
          });
        }
        offset = end;
      } else {
        offset = nextPes + 4;
      }
    } else {
      break;
    }
  }

  const streams: StreamInfo[] = [];
  const maxTimestamp = frames.reduce((max, frame) => Math.max(max, frame.pts), 0);
  if (hasVideo) {
    streams.push({
      index: 0, sourceId: 'video', kind: 'video',
      codec: 'H.264', codecFamily: 'h264',
      codecConfig: null,
      durationMs: maxTimestamp,
      sampleCount: frames.filter(frame => frame.kind === 'video').length,
      timeBase: { numerator: 1, denominator: 90_000 },
      video: spsInfo ? { width: Number(spsInfo._actualWidth) ?? 0, height: Number(spsInfo._actualHeight) ?? 0 } : undefined,
    });
  }
  if (hasAudio) {
    streams.push({
      index: hasVideo ? 1 : 0,
      sourceId: 'audio',
      kind: 'audio',
      codec: 'MPEG Audio',
      codecFamily: 'unknown',
      codecConfig: null,
      durationMs: maxTimestamp,
      sampleCount: frames.filter(frame => frame.kind === 'audio').length,
      timeBase: { numerator: 1, denominator: 90_000 },
    });
  }
  for (const frame of frames) {
    frame.streamIndex = frame.kind === 'video' ? 0 : hasVideo ? 1 : 0;
  }

  const format: MediaFormat = { container: 'mpegps', subtype: 'mpegps', details: {} };
  return { format, streams, frames, formatSpecific: { pesCount: frames.length }, fileSize: fileBytes.byteLength };
}
