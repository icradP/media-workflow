/**
 * MPEG-TS container analysis — 完整实现
 *
 * 合并包层 (packet/PAT/PMT) + PES 层 + TS 分析入口。
 * 从旧 lib/mpegTs/ (10文件) 重构为单文件。
 */

import { BitReader } from '../binary/reader.js';
import type { MediaAnalysisResult, StreamInfo, FrameInfo, MediaFormat } from '@media-workflow/core';
import type { H264SpsResult } from '../types.js';
import { parseH264SpsNaluPayload } from '../h264/sps.js';
import { parseHevcSpsNaluPayload } from '../h265/sps.js';
import { splitAnnexBNalus } from '../nalu/annexb.js';
import { pictureTypeFromNalType } from '../nalu/picture.js';
import { buildAvcCFromNalus } from '../packet/avcc.js';

// ─── Constants ───

const TS_PACKET_SIZE = 188;
const TS_SYNC_BYTE = 0x47;

const STREAM_TYPE_NAMES: Record<number, string> = {
  0x01: 'MPEG-1 Video', 0x02: 'MPEG-2 Video', 0x03: 'MPEG-1 Audio',
  0x04: 'MPEG-2 Audio', 0x06: 'PES private data', 0x0f: 'AAC (ADTS)',
  0x10: 'MPEG-4 Video', 0x11: 'AAC (LATM)', 0x1b: 'H.264 (AVC)',
  0x1c: 'AAC', 0x24: 'HEVC (H.265)', 0x42: 'AVS3',
};

function parseAdtsConfig(data: Uint8Array): Record<string, unknown> | null {
  const sampleRates = [
    96_000, 88_200, 64_000, 48_000, 44_100, 32_000, 24_000,
    22_050, 16_000, 12_000, 11_025, 8_000, 7_350,
  ];
  for (let offset = 0; offset + 7 <= Math.min(data.length, 256); offset++) {
    if (data[offset] !== 0xff || (data[offset + 1]! & 0xf6) !== 0xf0) continue;
    const sampleRateIndex = (data[offset + 2]! >> 2) & 0x0f;
    const sampleRate = sampleRates[sampleRateIndex];
    const audioObjectType = ((data[offset + 2]! >> 6) & 0x03) + 1;
    const profileNames = ['Main', 'LC', 'SSR', 'LTP'];
    const channels =
      ((data[offset + 2]! & 0x01) << 2) |
      ((data[offset + 3]! >> 6) & 0x03);
    if (!sampleRate || channels <= 0) continue;
    return {
      _samplingFrequency_value: sampleRate,
      _channelConfiguration_value: channels,
      audioObjectTypeName: profileNames[audioObjectType - 1] ?? `AAC object type ${audioObjectType}`,
    };
  }
  return null;
}

function buildAscFromAdts(data: Uint8Array): Uint8Array | null {
  for (let offset = 0; offset + 7 <= Math.min(data.length, 256); offset++) {
    if (data[offset] !== 0xff || (data[offset + 1]! & 0xf6) !== 0xf0) continue;
    const profile = ((data[offset + 2]! >> 6) & 0x03) + 1;
    const sampleRateIndex = (data[offset + 2]! >> 2) & 0x0f;
    const channels =
      ((data[offset + 2]! & 0x01) << 2) |
      ((data[offset + 3]! >> 6) & 0x03);
    const asc = new Uint8Array(2);
    asc[0] = ((profile & 0x1f) << 3) | ((sampleRateIndex & 0x0e) >> 1);
    asc[1] = ((sampleRateIndex & 0x01) << 7) | ((channels & 0x0f) << 3);
    return asc;
  }
  return null;
}

function streamTypeName(t: number): string {
  return STREAM_TYPE_NAMES[t] ?? `Unknown (0x${t.toString(16)})`;
}

function inspectVideoAccessUnit(
  data: Uint8Array,
  codecFamily: 'h264' | 'h265',
): { isKey: boolean; isIdr: boolean; pictureType?: string } {
  for (const nalu of splitAnnexBNalus(data)) {
    if (nalu.length === 0) continue;
    const nalType = codecFamily === 'h264'
      ? nalu[0]! & 0x1f
      : (nalu[0]! & 0x7e) >> 1;
    const pictureType = pictureTypeFromNalType(nalType, codecFamily);
    if (!pictureType) continue;
    const isIdr = codecFamily === 'h264'
      ? nalType === 5
      : nalType >= 16 && nalType <= 21;
    return { isKey: pictureType === 'I', isIdr, pictureType };
  }
  return { isKey: false, isIdr: false };
}

// ─── TS Packet ───

interface TsPacket {
  pid: number;
  payloadUnitStart: boolean;
  adaptationFieldCtrl: number;
  continuityCounter: number;
  payload: Uint8Array;
  offset: number;
}

function* iterateTsPackets(data: Uint8Array): Generator<TsPacket> {
  let offset = 0;
  // Find first sync byte
  while (offset < data.length && data[offset] !== TS_SYNC_BYTE) offset++;
  while (offset + TS_PACKET_SIZE <= data.length) {
    if (data[offset] !== TS_SYNC_BYTE) { offset++; continue; }
    const view = new DataView(data.buffer, data.byteOffset + offset, TS_PACKET_SIZE);
    const tei = (view.getUint8(1)! >> 7) & 1;
    const pusi = (view.getUint8(1)! >> 6) & 1;
    const tp = (view.getUint8(1)! >> 5) & 1;
    const pid = ((view.getUint8(1)! & 0x1f) << 8) | view.getUint8(2)!;
    const afc = (view.getUint8(3)! >> 4) & 3;
    const cc = view.getUint8(3)! & 0x0f;

    let payloadOff = 4;
    if (afc === 2 || afc === 3) {
      // Adaptation field present — skip it
      const afLen = view.getUint8(4)!;
      payloadOff = 5 + afLen;
    }

    const payloadLen = TS_PACKET_SIZE - payloadOff;
    const payload = payloadLen > 0
      ? new Uint8Array(data.buffer, data.byteOffset + offset + payloadOff, payloadLen)
      : new Uint8Array(0);

    yield { pid, payloadUnitStart: pusi === 1, adaptationFieldCtrl: afc, continuityCounter: cc, payload, offset };
    offset += TS_PACKET_SIZE;
  }
}

// ─── PAT / PMT ───

interface TsProgram {
  programNumber: number;
  pmtPid: number;
}

interface TsStream {
  pid: number;
  streamType: number;
  streamTypeName: string;
  /** Elementary stream descriptors raw bytes */
  descriptors: Uint8Array;
}

interface TsPmt {
  pcrPid: number;
  programNumber: number;
  streams: TsStream[];
}

function parsePatPacket(payload: Uint8Array): TsProgram[] {
  const reader = new BitReader(payload, 0);
  const pointerField = reader.readBits(8);
  reader.skip(pointerField);
  const sectionStart = reader.pos;
  const tableId = reader.readBits(8);
  if (tableId !== 0x00) return [];
  reader.readBits(4); // section syntax indicator + zero + reserved
  const sectionLen = ((reader.readBits(4) << 8) | reader.readBits(8));
  reader.readBits(16); // transport stream id
  reader.readBits(8); // reserved + version + current/next
  reader.readBits(8); // section number
  reader.readBits(8); // last section number

  const programs: TsProgram[] = [];
  const dataEnd = sectionStart + 3 + sectionLen - 4; // -CRC32
  while (reader.pos + 4 <= Math.min(dataEnd, payload.length)) {
    const progNum = reader.readBits(16);
    reader.readBits(3); // reserved
    const pmtPid = reader.readBits(13);
    if (progNum === 0) continue; // NIT
    programs.push({ programNumber: progNum, pmtPid });
  }
  return programs;
}

function parsePmtPacket(payload: Uint8Array): TsPmt | null {
  const reader = new BitReader(payload, 0);
  const pointerField = reader.readBits(8);
  reader.skip(pointerField);
  const sectionStart = reader.pos;
  const tableId = reader.readBits(8);
  if (tableId !== 0x02) return null;
  reader.readBits(4);
  const sectionLen = ((reader.readBits(4) << 8) | reader.readBits(8));
  const programNumber = reader.readBits(16);
  reader.readBits(8); // reserved + version + current/next
  reader.readBits(8); // section number
  reader.readBits(8); // last section number
  reader.readBits(3); // reserved
  const pcrPid = reader.readBits(13);
  reader.readBits(4); // reserved
  const progInfoLen = reader.readBits(12);
  reader.skip(progInfoLen);

  const streams: TsStream[] = [];
  const dataEnd = sectionStart + 3 + sectionLen - 4;
  while (reader.pos + 5 <= Math.min(dataEnd, payload.length)) {
    const streamType = reader.readBits(8);
    reader.readBits(3);
    const elemPid = reader.readBits(13);
    reader.readBits(4);
    const esInfoLen = reader.readBits(12);
    const descBytes = esInfoLen > 0 ? payload.slice(Math.floor(reader.bitPosition / 8), Math.floor(reader.bitPosition / 8) + esInfoLen) : new Uint8Array(0);
    if (reader.pos + esInfoLen > dataEnd || reader.pos + esInfoLen > payload.length) break;
    reader.skip(esInfoLen);
    streams.push({
      pid: elemPid,
      streamType,
      streamTypeName: streamTypeName(streamType),
      descriptors: descBytes,
    });
  }

  return { pcrPid, programNumber, streams };
}

// ─── PES ───

interface PesPacket {
  streamId: number;
  pts: number | null;
  dts: number | null;
  data: Uint8Array;
}

class PesAssembler {
  private buffer: Uint8Array[] = [];
  private totalLen = 0;
  private expectedLen = 0;
  private pts: number | null = null;
  private dts: number | null = null;

  feed(packet: TsPacket): PesPacket | null {
    if (packet.payloadUnitStart && this.buffer.length > 0) {
      // Previous PES completed — flush
      const result = this.flush();
      this.startNew(packet);
      return result;
    }
    if (packet.payloadUnitStart) {
      this.startNew(packet);
    } else if (this.buffer.length > 0) {
      this.buffer.push(packet.payload);
      this.totalLen += packet.payload.length;
      if (this.expectedLen > 0 && this.totalLen >= this.expectedLen) {
        return this.flush();
      }
    }
    return null;
  }

  private startNew(packet: TsPacket): void {
    this.buffer = [];
    this.totalLen = 0;
    this.pts = null;
    this.dts = null;

    const payload = packet.payload;
    if (payload.length < 6) return;

    // PES header
    const reader = new BitReader(payload, 0);
    const prefix = reader.readBits(24);
    if (prefix !== 1) return; // 0x000001
    const streamId = reader.readBits(8);
    const pesLen = reader.readBits(16);
    this.expectedLen = 0;

    // Skip PES header flags
    if (payload.length < 9) { this.buffer.push(payload); this.totalLen = payload.length; return; }
    reader.readBits(2); // marker bits
    reader.readBits(2); // PES_scrambling_control
    reader.readBits(1); // PES_priority
    reader.readBits(1); // data_alignment_indicator
    reader.readBits(1); // copyright
    reader.readBits(1); // original_or_copy
    const ptsDtsFlags = reader.readBits(2);
    reader.readBits(1); // ESCR_flag
    reader.readBits(1); // ES_rate_flag
    reader.readBits(1); // DSM_trick_mode_flag
    reader.readBits(1); // additional_copy_info_flag
    reader.readBits(1); // PES_CRC_flag
    reader.readBits(1); // PES_extension_flag
    const headerLen = reader.readBits(8);
    this.expectedLen = pesLen > 0 ? Math.max(0, pesLen - 3 - headerLen) : 0;

    // PTS/DTS
    const headerEnd = 9 + headerLen;
    if ((ptsDtsFlags & 2) && headerEnd >= 14) {
      const ptsReader = new BitReader(payload, 9);
      ptsReader.readBits(4);
      const pts32to30 = ptsReader.readBits(3);
      ptsReader.readBits(1);
      const pts29to15 = ptsReader.readBits(15);
      ptsReader.readBits(1);
      const pts14to0 = ptsReader.readBits(15);
      ptsReader.readBits(1);
      this.pts = (
        pts32to30 * 2 ** 30 +
        pts29to15 * 2 ** 15 +
        pts14to0
      ) / 90; // 90 kHz clock → ms
    }
    if ((ptsDtsFlags & 1) && headerEnd >= 19) {
      const dtsReader = new BitReader(payload, 14);
      dtsReader.readBits(4);
      const dts32to30 = dtsReader.readBits(3);
      dtsReader.readBits(1);
      const dts29to15 = dtsReader.readBits(15);
      dtsReader.readBits(1);
      const dts14to0 = dtsReader.readBits(15);
      this.dts = (
        dts32to30 * 2 ** 30 +
        dts29to15 * 2 ** 15 +
        dts14to0
      ) / 90;
    }

    const remaining = payload.slice(headerEnd);
    this.buffer.push(remaining);
    this.totalLen = remaining.length;
  }

  private flush(): PesPacket | null {
    if (this.buffer.length === 0) return null;
    const dataLength = this.expectedLen > 0
      ? Math.min(this.expectedLen, this.totalLen)
      : this.totalLen;
    const total = new Uint8Array(dataLength);
    let off = 0;
    for (const chunk of this.buffer) {
      const remaining = dataLength - off;
      if (remaining <= 0) break;
      const slice = chunk.subarray(0, remaining);
      total.set(slice, off);
      off += slice.length;
    }
    this.buffer = [];
    this.totalLen = 0;
    this.expectedLen = 0;
    return {
      streamId: 0, // will be set by caller
      pts: this.pts,
      dts: this.dts,
      data: total,
    };
  }

  forceFlush(): PesPacket | null { return this.flush(); }
}

// ─── Analysis ───

export function parseMpegTsForAnalysis(fileBytes: Uint8Array): MediaAnalysisResult {
  const packets = Array.from(iterateTsPackets(fileBytes));
  if (packets.length === 0) {
    return { format: { container: 'mpegts', subtype: 'mpegts', details: {} }, streams: [], frames: [], formatSpecific: {} };
  }

  // Collect PAT/PMT info
  const patPrograms: TsProgram[] = [];
  const pmtMap = new Map<number, TsPmt>();
  const streamPids = new Set<number>();
  let hasVideo = false, hasAudio = false;

  for (const pkt of packets) {
    if (pkt.pid === 0 && pkt.payloadUnitStart) {
      patPrograms.push(...parsePatPacket(pkt.payload));
    }
  }

  for (const prog of patPrograms) {
    for (const pkt of packets) {
      if (pkt.pid === prog.pmtPid && pkt.payloadUnitStart) {
        const pmt = parsePmtPacket(pkt.payload);
        if (pmt) {
          pmtMap.set(prog.pmtPid, pmt);
          for (const s of pmt.streams) {
            streamPids.add(s.pid);
            if (s.streamType === 0x1b || s.streamType === 0x24) hasVideo = true;
            if (s.streamType === 0x0f || s.streamType === 0x11 || s.streamType === 0x1c) hasAudio = true;
          }
        }
        break;
      }
    }
  }

  // PES assembly per PID
  const assemblers = new Map<number, PesAssembler>();
  const pesFrames: Array<{ pid: number; pts: number | null; data: Uint8Array }> = [];
  const streams: StreamInfo[] = [];
  let spsInfo: H264SpsResult | Record<string, unknown> | null = null;
  let audioConfig: Record<string, unknown> | null = null;
  let spsNalu: Uint8Array | null = null;
  let ppsNalu: Uint8Array | null = null;
  let aacAsc: Uint8Array | null = null;
  let frameIdx = 0;

  for (const pkt of packets) {
    const pid = pkt.pid;
    if (!streamPids.has(pid)) continue;

    let asm = assemblers.get(pid);
    if (!asm) { asm = new PesAssembler(); assemblers.set(pid, asm); }

    const pes = asm.feed(pkt);
    if (pes) {
      // Detect codec type from PMT
      let codec: string | null = null;
      for (const [, pmt] of pmtMap) {
        for (const s of pmt.streams) {
          if (s.pid === pid) { codec = s.streamTypeName; break; }
        }
        if (codec) break;
      }

      // Try SPS/AAC config extraction from first PES
      if (codec?.includes('H.264') || codec?.includes('AVC')) {
        if (pes.data.length > 4) {
          const nalus = splitAnnexBNalus(pes.data);
          for (const nalu of nalus) {
            if (nalu.length > 1) {
              const nalType = nalu[0]! & 0x1f;
              if (nalType === 7 && !spsInfo) {
                const sps = parseH264SpsNaluPayload(nalu);
                if (sps._actualWidth) {
                  spsInfo = sps;
                  spsNalu = nalu.slice();
                }
              } else if (nalType === 8 && !ppsNalu) {
                ppsNalu = nalu.slice();
              }
            }
          }
        }
      } else if (codec?.includes('HEVC')) {
        if (!spsInfo && pes.data.length > 4) {
          const nalus = splitAnnexBNalus(pes.data);
          for (const nalu of nalus) {
            if (nalu.length > 2 && ((nalu[0]! & 0x7e) >> 1) === 33) {
              const sps = parseHevcSpsNaluPayload(nalu);
              if (sps._actualWidth) spsInfo = sps;
            }
          }
        }
      } else if (codec?.includes('AAC') && !audioConfig) {
        audioConfig = parseAdtsConfig(pes.data);
        if (audioConfig && pes.data.byteLength >= 7) {
          aacAsc = buildAscFromAdts(pes.data);
        }
      }

      pesFrames.push({ pid, pts: pes.pts, data: pes.data });
    }
  }

  // Flush remaining
  for (const [pid, asm] of assemblers) {
    const pes = asm.forceFlush();
    if (pes && pes.data.length > 0) pesFrames.push({ pid, pts: pes.pts, data: pes.data });
  }

  // Build one normalized legacy stream per PMT elementary PID.
  const streamDescriptors = [...pmtMap.values()].flatMap(pmt => pmt.streams);
  for (const descriptor of streamDescriptors) {
    const isVideo = descriptor.streamType === 0x1b || descriptor.streamType === 0x24;
    const isAudio = descriptor.streamType === 0x0f ||
      descriptor.streamType === 0x11 ||
      descriptor.streamType === 0x1c;
    if (!isVideo && !isAudio) continue;

    const index = streams.length;
    const isHevc = descriptor.streamType === 0x24;
    const trackFrames = pesFrames.filter(frame => frame.pid === descriptor.pid);
    const timestamps = trackFrames
      .map(frame => frame.pts)
      .filter((value): value is number => value !== null);
    const durationMs = timestamps.length > 1
      ? Math.max(...timestamps) - Math.min(...timestamps)
      : undefined;
    streams.push({
      index,
      sourceId: descriptor.pid,
      kind: isVideo ? 'video' : 'audio',
      codec: isVideo ? (isHevc ? 'H.265' : 'H.264') : 'AAC',
      codecFamily: isVideo ? (isHevc ? 'h265' : 'h264') : 'aac',
      codecConfig: isVideo
        ? (spsNalu && ppsNalu ? buildAvcCFromNalus(spsNalu, ppsNalu) : null)
        : aacAsc,
      durationMs,
      sampleCount: trackFrames.length,
      timeBase: { numerator: 1, denominator: 90_000 },
      metadata: {
        pid: descriptor.pid,
        streamType: descriptor.streamType,
        streamTypeName: descriptor.streamTypeName,
      },
      video: isVideo && spsInfo ? {
        width: Number(spsInfo._actualWidth) || 0,
        height: Number(spsInfo._actualHeight) || 0,
        profile: String(spsInfo.profile_idc ?? ''),
        level: String(spsInfo.level_idc ?? ''),
        bitDepth: Number(spsInfo._bit_depth_luma_value) || undefined,
        chromaFormat: Number(spsInfo._chroma_format_idc_value) || undefined,
      } : undefined,
      audio: isAudio &&
        Number(audioConfig?._samplingFrequency_value) > 0 &&
        Number(audioConfig?._channelConfiguration_value) > 0
        ? {
            sampleRate: Number(audioConfig?._samplingFrequency_value),
            channels: Number(audioConfig?._channelConfiguration_value),
            profile: String(audioConfig?.audioObjectTypeName ?? ''),
          }
        : undefined,
    });
  }

  const frames: FrameInfo[] = pesFrames.flatMap((pes, i) => {
    const descriptor = streamDescriptors.find(stream => stream.pid === pes.pid);
    if (!descriptor) return [];
    const isVideo = descriptor.streamType === 0x1b || descriptor.streamType === 0x24;
    const streamIndex = streamDescriptors
      .filter(stream => {
        const video = stream.streamType === 0x1b || stream.streamType === 0x24;
        const audio = stream.streamType === 0x0f || stream.streamType === 0x11 || stream.streamType === 0x1c;
        return video || audio;
      })
      .findIndex(stream => stream.pid === pes.pid);
    if (streamIndex < 0) return [];
    const accessUnit = isVideo
      ? inspectVideoAccessUnit(
          pes.data,
          descriptor.streamType === 0x24 ? 'h265' : 'h264',
        )
      : { isKey: true, isIdr: false, pictureType: undefined };

    return [{
      index: i,
      streamIndex,
      kind: isVideo ? 'video' as const : 'audio' as const,
      dts: pes.pts ?? i * 40,
      pts: pes.pts ?? i * 40,
      offset: 0,
      size: pes.data.length,
      isKey: accessUnit.isKey,
      isIdr: accessUnit.isIdr,
      pictureType: accessUnit.pictureType,
      rawData: pes.data,
      dataOrigin: 'demuxed_payload',
    }];
  });

  return {
    format: { container: 'mpegts', subtype: 'mpegts', details: { packetCount: packets.length } },
    streams, frames,
    formatSpecific: { packetCount: packets.length, pesCount: pesFrames.length },
    fileSize: fileBytes.byteLength,
  };
}
