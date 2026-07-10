/**
 * Common weighted prediction parsing.
 *
 * Shared by H.264 and H.265 slice header parsers.
 */

import type { BitReader } from '../binary/reader.js';

export interface WeightedPredictionOptions {
  sliceType: number;
  weightedPredFlag: boolean;
  weightedBipredFlag: boolean;
  weightIsDelta?: boolean;
  checkBitDepthChroma?: boolean;
  bitDepthChroma?: number;
  chromaFormatIdc?: number;
  numRefL0?: number;
  numRefL1?: number;
  lumaWeightPrefix?: string;
  lumaOffsetPrefix?: string;
  chromaWeightPrefix?: string;
  chromaOffsetPrefix?: string;
  deltaLumaWeightPrefix?: string;
  deltaChromaWeightPrefix?: string;
  deltaChromaOffsetPrefix?: string;
}

export function parseWeightedPrediction(
  reader: BitReader,
  out: Record<string, unknown>,
  options: WeightedPredictionOptions,
): void {
  const {
    sliceType,
    weightedPredFlag,
    weightedBipredFlag,
    weightIsDelta = false,
    checkBitDepthChroma = false,
    bitDepthChroma = 0,
    chromaFormatIdc = 1,
    numRefL0 = 0,
    numRefL1 = 0,
    lumaWeightPrefix = 'luma_weight',
    lumaOffsetPrefix = 'luma_offset',
    chromaWeightPrefix = 'chroma_weight',
    chromaOffsetPrefix = 'chroma_offset',
    deltaLumaWeightPrefix = 'delta_luma_weight',
    deltaChromaWeightPrefix = 'delta_chroma_weight',
    deltaChromaOffsetPrefix = 'delta_chroma_offset',
  } = options;

  const isWeightedP = weightedPredFlag && (sliceType === 0 || sliceType === 3);
  const isWeightedB = weightedBipredFlag && sliceType === 1;
  if (!isWeightedP && !isWeightedB) return;

  out.luma_log2_weight_denom = reader.readUE();

  const hasChroma = checkBitDepthChroma
    ? (bitDepthChroma === 0 && chromaFormatIdc !== 0)
    : (chromaFormatIdc !== 0);

  if (hasChroma) {
    if (weightIsDelta) {
      out.delta_chroma_log2_weight_denom = reader.readSE();
    } else {
      out.chroma_log2_weight_denom = reader.readUE();
    }
  }

  parseWeightList(reader, out, 'l0', numRefL0, hasChroma, weightIsDelta, {
    lumaWeightPrefix, lumaOffsetPrefix, chromaWeightPrefix, chromaOffsetPrefix,
    deltaLumaWeightPrefix, deltaChromaWeightPrefix, deltaChromaOffsetPrefix,
  });

  if (sliceType === 1) {
    parseWeightList(reader, out, 'l1', numRefL1, hasChroma, weightIsDelta, {
      lumaWeightPrefix, lumaOffsetPrefix, chromaWeightPrefix, chromaOffsetPrefix,
      deltaLumaWeightPrefix, deltaChromaWeightPrefix, deltaChromaOffsetPrefix,
    });
  }
}

function parseWeightList(
  reader: BitReader,
  out: Record<string, unknown>,
  listId: string,
  numRef: number,
  hasChroma: boolean,
  weightIsDelta: boolean,
  prefixes: {
    lumaWeightPrefix: string;
    lumaOffsetPrefix: string;
    chromaWeightPrefix: string;
    chromaOffsetPrefix: string;
    deltaLumaWeightPrefix: string;
    deltaChromaWeightPrefix: string;
    deltaChromaOffsetPrefix: string;
  },
): void {
  for (let i = 0; i <= numRef; i++) {
    const lwFlag = reader.readBits(1);
    out[`luma_weight_${listId}_flag[${i}]`] = lwFlag;
    if (lwFlag) {
      if (weightIsDelta) {
        out[`${prefixes.deltaLumaWeightPrefix}_${listId}[${i}]`] = reader.readSE();
      }
      out[`${prefixes.lumaWeightPrefix}_${listId}[${i}]`] = reader.readSE();
      out[`${prefixes.lumaOffsetPrefix}_${listId}[${i}]`] = reader.readSE();
    }

    if (hasChroma) {
      const cwFlag = reader.readBits(1);
      out[`chroma_weight_${listId}_flag[${i}]`] = cwFlag;
      if (cwFlag) {
        for (let j = 0; j < 2; j++) {
          if (weightIsDelta) {
            out[`${prefixes.deltaChromaWeightPrefix}_${listId}[${i}][${j}]`] = reader.readSE();
            out[`${prefixes.deltaChromaOffsetPrefix}_${listId}[${i}][${j}]`] = reader.readSE();
          } else {
            out[`${prefixes.chromaWeightPrefix}_${listId}[${i}][${j}]`] = reader.readSE();
            out[`${prefixes.chromaOffsetPrefix}_${listId}[${i}][${j}]`] = reader.readSE();
          }
        }
      }
    }
  }
}
