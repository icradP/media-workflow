/**
 * H.265/HEVC Short-term reference picture set parser.
 */

import { BitReader } from '../binary/reader.js';

function parseHevcStRefPicSet(
  reader: BitReader, stRpsIdx: number, numSets: number,
  spsMaxBuf: number, prevSets: Array<{ numDeltaPocs: number }>,
  out: Record<string, unknown>, prefix: string,
): boolean {
  const pfx = `${prefix}[${stRpsIdx}]`;
  let interFlag = 0;
  if (stRpsIdx !== 0) interFlag = reader.readBits(1, `${pfx}.inter_ref_pic_set_prediction_flag`);
  const entry = { numDeltaPocs: 0 };

  if (interFlag) {
    let deltaIdxMinus1 = 0;
    if (stRpsIdx === numSets) deltaIdxMinus1 = reader.readUE(`${pfx}.delta_idx_minus1`);
    const deltaRpsSign = reader.readBits(1, `${pfx}.delta_rps_sign`);
    const absDelta = reader.readUE(`${pfx}.abs_delta_rps_minus1`);
    const deltaRps = (1 - 2 * deltaRpsSign) * (absDelta + 1);
    const refIdx = stRpsIdx - (deltaIdxMinus1 + 1);
    if (refIdx < 0 || refIdx >= prevSets.length) return false;
    const numPocs = prevSets[refIdx]!.numDeltaPocs;
    const usedByFlag: number[] = [], useDeltaFlag: number[] = [];
    for (let j = 0; j <= numPocs; j++) {
      usedByFlag[j] = reader.readBits(1, `${pfx}.used_by_curr_pic_flag[${j}]`);
      useDeltaFlag[j] = usedByFlag[j] ? 1 : reader.readBits(1, `${pfx}.use_delta_flag[${j}]`);
    }
    out[`${pfx}.inter_ref_pic_set_prediction_flag`] = interFlag;
    out[`${pfx}.delta_rps`] = deltaRps;
    out[`${pfx}.used_by_curr_pic_flag`] = usedByFlag;
    entry.numDeltaPocs = numPocs;
  } else {
    const numNeg = reader.readUE(`${pfx}.num_negative_pics`);
    const numPos = reader.readUE(`${pfx}.num_positive_pics`);
    const dS0: number[] = [], usedS0: number[] = [];
    for (let i = 0; i < numNeg; i++) {
      const m1 = reader.readUE(`${pfx}.delta_poc_s0_minus1[${i}]`);
      dS0[i] = i === 0 ? -(m1 + 1) : dS0[i - 1]! - (m1 + 1);
      usedS0[i] = reader.readBits(1, `${pfx}.used_by_curr_pic_s0_flag[${i}]`);
    }
    const dS1: number[] = [], usedS1: number[] = [];
    for (let i = 0; i < numPos; i++) {
      const m1 = reader.readUE(`${pfx}.delta_poc_s1_minus1[${i}]`);
      dS1[i] = i === 0 ? m1 + 1 : dS1[i - 1]! + m1 + 1;
      usedS1[i] = reader.readBits(1, `${pfx}.used_by_curr_pic_s1_flag[${i}]`);
    }
    out[`${pfx}.inter_ref_pic_set_prediction_flag`] = 0;
    out[`${pfx}.num_negative_pics`] = numNeg;
    out[`${pfx}.num_positive_pics`] = numPos;
    out[`${pfx}.delta_poc_s0`] = dS0;
    out[`${pfx}.used_by_curr_pic_s0_flag`] = usedS0;
    out[`${pfx}.delta_poc_s1`] = dS1;
    out[`${pfx}.used_by_curr_pic_s1_flag`] = usedS1;
    entry.numDeltaPocs = numNeg + numPos;
  }

  prevSets.push(entry);
  return true;
}

export function parseHevcSpsShortTermRefPicSets(
  reader: BitReader, numSets: number, spsMaxSubLayersMinus1: number,
  s: Record<string, unknown>, keyPrefix: string,
): void {
  const maxBuf = Number(s[`sps_max_dec_pic_buffering_minus1[${spsMaxSubLayersMinus1}]`]) ??
                 Number(s['sps_max_dec_pic_buffering_minus1[0]']) ?? 16;
  const prev: Array<{ numDeltaPocs: number }> = [];
  const prefix = `${keyPrefix}.short_term_ref_pic_set`;
  for (let i = 0; i < numSets; i++) {
    if (!parseHevcStRefPicSet(reader, i, numSets, maxBuf, prev, s, prefix)) {
      (s as Record<string, unknown>)._st_rps_parse_error = `short_term_ref_pic_set[${i}]`;
      return;
    }
  }
}
