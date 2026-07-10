/**
 * Generic length-prefixed NAL unit scanner.
 *
 * Shared skeleton for H.264 and H.265 NAL scanning.
 * Codec-specific behavior is injected via callbacks.
 */

import { BitReader } from '../binary/reader.js';
import type { NalUnit } from '@media-workflow/core';

export interface NalScannerCallbacks {
  codecType: 'h264' | 'h265';
  headerLen: number;
  readHeader(reader: BitReader): Record<string, unknown>;
  buildEntry(
    payload: Uint8Array,
    headerInfo: Record<string, unknown>,
    headerLen: number,
    naluLength: number,
    index: number,
    payloadOffset: number,
  ): Record<string, unknown>;
  dispatchType(
    entry: Record<string, unknown>,
    payload: Uint8Array,
    payloadOffset: number,
    fieldOffsets: Record<string, unknown>,
    key: string,
    nalType: number,
    sps: Record<string, unknown> | null,
    pps: Record<string, unknown> | null,
  ): void;
  extractSpsInfo(sps: Record<string, unknown> | null): Record<string, unknown> | null;
}

export interface NalScannerOptions {
  view: DataView;
  byteOffset: number;
  byteLength: number;
  lengthSizeMinusOne?: number;
  fieldOffsets?: Record<string, unknown>;
  decoderConfig?: Record<string, unknown> | null;
}

export interface NalScanResult extends Array<Record<string, unknown>> {
  spsInfo?: Record<string, unknown> | null;
}

/**
 * Generic length-prefixed NAL unit scanner.
 *
 * Walks through a length-prefixed sample, parsing each NAL unit header
 * and dispatching to codec-specific payload parsers.
 */
export function parseLengthPrefixedNalUnits(
  options: NalScannerOptions,
  callbacks: NalScannerCallbacks,
): NalScanResult {
  const {
    view,
    byteOffset,
    byteLength,
    lengthSizeMinusOne = 3,
    fieldOffsets = {},
    decoderConfig = null,
  } = options;

  const {
    headerLen,
    readHeader,
    buildEntry,
    dispatchType,
    extractSpsInfo,
  } = callbacks;

  const out = [] as NalScanResult;
  let pos = byteOffset;
  const end = byteOffset + byteLength;
  const lenBytes = lengthSizeMinusOne + 1;
  let index = 0;
  let sps: Record<string, unknown> | null = (decoderConfig?.['sps[0]'] as Record<string, unknown>) ?? null;
  let pps: Record<string, unknown> | null = (decoderConfig?.['pps[0]'] as Record<string, unknown>) ?? null;

  for (; pos + lenBytes < end;) {
    let nalLen = 0;
    if (lenBytes === 4) nalLen = view.getUint32(pos, false);
    else if (lenBytes === 2) nalLen = view.getUint16(pos, false);
    else if (lenBytes === 1) nalLen = view.getUint8(pos);
    else break;

    if (nalLen === 0 || pos + lenBytes + nalLen > end) break;

    const payloadOffset = pos + lenBytes;
    const payload = new Uint8Array(view.buffer, view.byteOffset + payloadOffset, nalLen);

    if (payload.length < headerLen) break;

    const key = `nalu[${index}]`;
    const headerBytes = payload.slice(0, headerLen);
    const headerReader = new BitReader(headerBytes, 0);
    const headerInfo = readHeader(headerReader);

    const entry = buildEntry(payload, headerInfo, headerLen, nalLen, index, payloadOffset);

    if (fieldOffsets) {
      (fieldOffsets as Record<string, unknown>)[`${key}.naluLength`] = { offset: pos, length: lenBytes };
    }

    const nalType = typeof entry._nal_unit_type_value === 'number' ? entry._nal_unit_type_value : 0;
    try {
      dispatchType(entry, payload, payloadOffset, fieldOffsets, key, nalType, sps, pps);
    } catch {
      // Single NALU parse failure should not affect subsequent ones
    }

    if (entry._isSps) sps = entry;
    if (entry._isPps) pps = entry;

    out.push(entry);
    pos = payloadOffset + nalLen;
    index++;
  }

  out.spsInfo = extractSpsInfo(sps);
  return out;
}
