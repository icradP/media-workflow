/**
 * H.265/HEVC SEI NAL unit parser.
 */

import { BitReader } from '../binary/reader.js';
import { removeEmulationPrevention } from '../nalu/annexb.js';
import { hevcNalUnitTypeName, HEVC_SEI_PAYLOAD_LABELS } from './constants.js';
import { readHevcNalUnitHeader } from './header.js';
import { parseSeiRbspMessageLoop, readSeiRbspTrailingBits } from '../h264/sei.js';

function lookupHevcSeiPayloadType(t: number): string | null {
  return HEVC_SEI_PAYLOAD_LABELS[t] ?? null;
}

export function parseHevcSeiNaluPayload(
  nalu: Uint8Array, baseByteOffset = 0,
  fieldOffsets: Record<string, { offset: number; length: number }> = {},
  seiIndex: number | string = 0,
): Record<string, unknown> {
  if (!nalu || nalu.length < 2) return {};
  try {
    const s = {} as Record<string, unknown>;
    const keyPrefix = typeof seiIndex === 'string' ? seiIndex : `sequenceHeader.sei[${seiIndex}]`;
    const header = nalu.slice(0, 2);
    const { data: rbsp, removedPositions } = removeEmulationPrevention(nalu.slice(2));
    const combined = new Uint8Array(header.length + rbsp.length);
    combined.set(header, 0); combined.set(rbsp, header.length);
    const adjPos = removedPositions.map(p => p + 2);
    const reader = new BitReader(combined, 0, baseByteOffset, fieldOffsets, keyPrefix, adjPos);

    const hdr = readHevcNalUnitHeader(reader);
    s.forbidden_zero_bit = hdr.forbidden_zero_bit;
    s.nal_unit_type = `${hdr.nal_unit_type} (${hevcNalUnitTypeName(hdr.nal_unit_type)})`;
    s.nuh_layer_id = hdr.nuh_layer_id;
    s.nuh_temporal_id_plus1 = hdr.nuh_temporal_id_plus1;

    if (combined.length - Math.floor(reader.bitPosition / 8) <= 1) {
      s._note = 'SEI data too short or empty';
      return s;
    }

    parseSeiRbspMessageLoop(reader, combined, s, lookupHevcSeiPayloadType);
    readSeiRbspTrailingBits(reader, combined, s);
    return s;
  } catch (err) { /* SEI parse failure */ return { _parseError: String(err) }; }
}
