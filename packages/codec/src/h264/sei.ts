/**
 * H.264 SEI NAL unit parser (nal_unit_type 6).
 */

import { BitReader } from '../binary/reader.js';
import { removeEmulationPrevention } from '../nalu/annexb.js';
import { readH264NalUnitHeader } from './sps.js';

/** SEI payloadType → name */
export const SEI_PAYLOAD_TYPE_NAMES: Record<number, string> = {
  0: 'buffering_period', 1: 'pic_timing', 2: 'pan_scan_rect',
  3: 'filler_payload', 4: 'user_data_registered_itu_t_t35',
  5: 'user_data_unregistered', 6: 'recovery_point',
  7: 'dec_ref_pic_marking_repetition', 8: 'spare_pic', 9: 'scene_info',
  10: 'sub_seq_info', 11: 'sub_seq_layer_characteristics',
  12: 'sub_seq_characteristics', 13: 'full_frame_freeze',
  14: 'full_frame_freeze_release', 15: 'full_frame_snapshot',
  16: 'progressive_refinement_segment_start', 17: 'progressive_refinement_segment_end',
  18: 'motion_constrained_slice_group_set', 19: 'film_grain_characteristics',
  20: 'deblocking_filter_display_preference', 21: 'stereo_video_info',
  22: 'post_filter_hint', 23: 'tone_mapping_info',
  45: 'frame_packing_arrangement', 47: 'display_orientation',
  128: 'frame_packing_arrangement', 129: 'display_orientation',
  130: 'mastering_display_colour_volume', 137: 'mastering_display_info',
  144: 'content_light_level_info', 147: 'alternative_transfer_characteristics',
};

function seiPayloadTypeName(type: number): string | null {
  return SEI_PAYLOAD_TYPE_NAMES[type] ?? null;
}

type SeiLookupFn = (type: number) => string | null;

function readSeiMessagePayload(
  reader: BitReader,
  out: Record<string, unknown>,
  messageIndex: number,
  payloadType: number,
  payloadSize: number,
): void {
  const i = messageIndex;
  if (payloadType === 4 && payloadSize >= 3) {
    const byteStart = Math.floor(reader.bitPosition / 8);
    reader.startField(`itu_t_t35_country_code[${i}]`);
    const countryCode = reader.readBitsRaw(8);
    reader.finishField(`itu_t_t35_country_code[${i}]`);
    out[`itu_t_t35_country_code[${i}]`] = `0x${countryCode.toString(16).padStart(2, '0')}`;

    let providerCode = 0;
    if (countryCode === 181 && payloadSize >= 4) {
      reader.startField(`itu_t_t35_provider_code[${i}]`);
      providerCode = (reader.readBitsRaw(8) << 8) | reader.readBitsRaw(8);
      reader.finishField(`itu_t_t35_provider_code[${i}]`);
      out[`itu_t_t35_provider_code[${i}]`] = `0x${providerCode.toString(16).padStart(4, '0')}`;

      if (providerCode === 49 && payloadSize >= 7) {
        const userId = reader.readString(4, `user_identifier[${i}]`);
        out[`user_identifier[${i}]`] = userId;
        if (userId === 'GA94') {
          (out as Record<string, unknown>)._hasClosedCaptions = true;
          out[`caption_type[${i}]`] = 'EIA-608/CEA-708';
        }
      }
    }
    const readBytes = Math.floor(reader.bitPosition / 8) - byteStart;
    const remaining = payloadSize - readBytes;
    if (remaining > 0) {
      reader.startField(`user_data_payload_byte[${i}]`);
      for (let j = 0; j < remaining; j++) reader.readBitsRaw(8);
      reader.finishField(`user_data_payload_byte[${i}]`);
      out[`user_data_payload_byte[${i}]`] = `Uint8Array(${remaining})`;
    }
  } else if (payloadType === 5 && payloadSize >= 16) {
    reader.startField(`uuid_iso_iec_11578[${i}]`);
    const uuidBytes: number[] = [];
    for (let j = 0; j < 16; j++) uuidBytes.push(reader.readBitsRaw(8));
    reader.finishField(`uuid_iso_iec_11578[${i}]`);
    const hex = uuidBytes.map(b => b.toString(16).padStart(2, '0')).join('');
    const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
    out[`uuid_iso_iec_11578[${i}]`] = uuid;

    const remaining = payloadSize - 16;
    if (remaining > 0) {
      reader.startField(`user_data_payload_byte[${i}]`);
      for (let j = 0; j < remaining; j++) reader.readBitsRaw(8);
      reader.finishField(`user_data_payload_byte[${i}]`);
      out[`user_data_payload_byte[${i}]`] = `Uint8Array(${remaining})`;
    }
  } else {
    for (let j = 0; j < payloadSize; j++) {
      out[`payload_byte[${j}]`] = reader.readBits(8, `payload_byte[${j}]`);
    }
  }
}

export function parseSeiRbspMessageLoop(
  reader: BitReader,
  rbspBytes: Uint8Array,
  out: Record<string, unknown>,
  lookupPayloadType: SeiLookupFn = seiPayloadTypeName,
): void {
  let r = 0;
  for (; Math.floor(reader.bitPosition / 8) < rbspBytes.length - 1;) {
    const start = Math.floor(reader.bitPosition / 8);
    if (start >= rbspBytes.length - 1) break;

    let payloadType = 0;
    let off = 0;
    for (; start + off < rbspBytes.length && rbspBytes[start + off] === 255;) {
      payloadType += 255;
      off++;
    }
    if (start + off >= rbspBytes.length) break;
    payloadType += rbspBytes[start + off]!;
    off++;

    reader.startField(`payloadType[${r}]`);
    for (let p = 0; p < off; p++) reader.readBitsRaw(8);
    reader.finishField(`payloadType[${r}]`);

    let payloadSize = 0;
    let m = start + off;
    let h = 0;
    for (; m + h < rbspBytes.length && rbspBytes[m + h] === 255;) {
      payloadSize += 255;
      h++;
    }
    if (m + h >= rbspBytes.length) break;
    payloadSize += rbspBytes[m + h]!;
    h++;

    reader.startField(`payloadSize[${r}]`);
    for (let p = 0; p < h; p++) reader.readBitsRaw(8);
    reader.finishField(`payloadSize[${r}]`);

    if (Math.floor(reader.bitPosition / 8) + payloadSize > rbspBytes.length) break;

    const name = lookupPayloadType(payloadType);
    out[`payloadType[${r}]`] = name ? `${payloadType} (${name})` : payloadType;
    (out as Record<string, unknown>)[`_payloadType[${r}]_value`] = payloadType;
    out[`payloadSize[${r}]`] = payloadSize;

    readSeiMessagePayload(reader, out, r, payloadType, payloadSize);
    r++;
  }
  if (r === 0) (out as Record<string, unknown>)._note = 'No SEI messages found';
}

export function readSeiRbspTrailingBits(
  reader: BitReader,
  rbspBytes: Uint8Array,
  out: Record<string, unknown>,
): void {
  if (reader.bitPosition < rbspBytes.length * 8) {
    out.rbsp_stop_one_bit = reader.readBits(1, 'rbsp_stop_one_bit');
    let idx = 0;
    for (; reader.bitPosition % 8 !== 0 && reader.bitPosition < rbspBytes.length * 8;) {
      out[`rbsp_alignment_zero_bit[${idx}]`] = reader.readBits(1, `rbsp_alignment_zero_bit[${idx}]`);
      idx++;
    }
  }
}

export function parseH264SeiNaluPayload(
  nalu: Uint8Array,
  baseByteOffset = 0,
  fieldOffsets: Record<string, { offset: number; length: number }> = {},
  seiIndex: number | string = 0,
): Record<string, unknown> {
  if (!nalu || nalu.length < 1) return {};

  try {
    const s = {} as Record<string, unknown>;
    const keyPrefix = typeof seiIndex === 'string' ? seiIndex : `sequenceHeader.sei[${seiIndex}]`;

    const headerByte = nalu.slice(0, 1);
    const { data: rbsp, removedPositions } = removeEmulationPrevention(nalu.slice(1));
    const combined = new Uint8Array(headerByte.length + rbsp.length);
    combined.set(headerByte, 0);
    combined.set(rbsp, headerByte.length);
    const adjustedPositions = removedPositions.map(p => p + 1);

    const reader = new BitReader(combined, 0, baseByteOffset, fieldOffsets, keyPrefix, adjustedPositions);
    const nalHdr = readH264NalUnitHeader(reader);
    s.forbidden_zero_bit = nalHdr.forbidden_zero_bit;
    s.nal_ref_idc = nalHdr.nal_ref_idc;
    s.nal_unit_type = nalHdr.nal_unit_type;

    if (combined.length - Math.floor(reader.bitPosition / 8) <= 1) {
      (s as Record<string, unknown>)._note = 'SEI data too short or empty';
      return s;
    }

    parseSeiRbspMessageLoop(reader, combined, s);
    readSeiRbspTrailingBits(reader, combined, s);

    return s;
  } catch { /* SEI parse failure — return empty */
    return {};
  }
}
