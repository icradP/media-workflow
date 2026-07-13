/**
 * AAC AudioSpecificConfig parser.
 *
 * Parses the 2+ byte AudioSpecificConfig structure defined in ISO/IEC 14496-3.
 */

import { BitReader } from '../binary/reader.js';
import {
  AAC_SAMPLING_FREQUENCIES,
  getAudioObjectTypeName,
  getChannelLayoutLabel,
} from './constants.js';

export function parseAudioSpecificConfig(
  data: Uint8Array,
  byteOffset = 0,
  fieldOffsets?: Record<string, { offset: number; length: number }> | null,
  prefix = '',
  baseOffset = 0,
): Record<string, unknown> {
  if (!data || data.length < 2) return {};

  const c = {} as Record<string, unknown>;
  const reader = new BitReader(
    data, byteOffset, baseOffset,
    fieldOffsets ?? undefined, prefix,
  );

  c.audioObjectType = reader.readBits(5, 'audioObjectType');
  c.originalAudioObjectType = c.audioObjectType;
  c.audioObjectTypeName = getAudioObjectTypeName(c.audioObjectType as number);
  c.profile = c.audioObjectType;

  const freqIdx = reader.readBits(4, 'samplingFrequencyIndex');
  c.samplingFrequencyIndex = freqIdx;
  if (freqIdx === 15) {
    c.samplingFrequency = reader.readBits(24, 'samplingFrequency');
    (c as Record<string, unknown>)._samplingFrequency_value = c.samplingFrequency;
  } else {
    c.samplingFrequency = AAC_SAMPLING_FREQUENCIES[freqIdx] ?? 0;
    (c as Record<string, unknown>)._samplingFrequency_value = c.samplingFrequency;
  }

  const chanCfg = reader.readBits(4, 'channelConfiguration');
  c.channelConfiguration = chanCfg;
  c.channels = chanCfg;
  (c as Record<string, unknown>)._channelConfiguration_value = chanCfg;
  c.channelLayout = getChannelLayoutLabel(chanCfg);

  c.frameLengthFlag = reader.readBits(1, 'frameLengthFlag');
  c.dependsOnCoreCoder = reader.readBits(1, 'dependsOnCoreCoder');
  c.extensionFlag = reader.readBits(1, 'extensionFlag');

  const aot = c.audioObjectType as number;
  if (aot === 5 || aot === 29) {
    if (data.length >= byteOffset + 3) {
      const extFreqIdx = reader.readBits(4, 'extensionSamplingFrequencyIndex');
      c.extensionSamplingFrequencyIndex = extFreqIdx;
      if (extFreqIdx === 15) {
        c.extensionSamplingFrequency = reader.readBits(24, 'extensionSamplingFrequency');
      } else {
        c.extensionSamplingFrequency = AAC_SAMPLING_FREQUENCIES[extFreqIdx] ?? 0;
      }
      const extAot = reader.readBits(5, 'extensionAudioObjectType');
      c.extensionAudioObjectType = extAot;
      c.extensionAudioObjectTypeName = getAudioObjectTypeName(extAot);
    }
  } else if (data.length >= byteOffset + 4) {
    const savedPos = reader.bitPosition;
    const syncType = reader.readBits(11, 'syncExtensionType');
    if (syncType === 695) {
      c.syncExtensionType = syncType;
      const extAot = reader.readBits(5, 'extensionAudioObjectType');
      c.extensionAudioObjectType = extAot;
      c.extensionAudioObjectTypeName = getAudioObjectTypeName(extAot);
      if (extAot === 5) {
        c.sbrPresentFlag = reader.readBits(1, 'sbrPresentFlag');
        if (c.sbrPresentFlag === 1) {
          const extFreqIdx = reader.readBits(4, 'extensionSamplingFrequencyIndex');
          c.extensionSamplingFrequencyIndex = extFreqIdx;
          c.extensionSamplingFrequency = extFreqIdx === 15
            ? reader.readBits(24, 'extensionSamplingFrequency')
            : (AAC_SAMPLING_FREQUENCIES[extFreqIdx] ?? 0);
          const savedPos2 = reader.bitPosition;
          const syncType2 = reader.readBits(11, 'syncExtensionType2');
          if (syncType2 === 1352) {
            c.syncExtensionType2 = syncType2;
            c.psPresentFlag = reader.readBits(1, 'psPresentFlag');
          } else {
            reader.bitOff = 0; // rough position restore
            // Note: proper restore is complex; skip for now
          }
        }
      } else if (extAot === 22) {
        c.psPresentFlag = reader.readBits(1, 'psPresentFlag');
      }
    }
  }

  return c;
}

/** Build a 2-byte AudioSpecificConfig from the first ADTS frame in a buffer. */
export function buildAscFromAdts(data: Uint8Array): Uint8Array | null {
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
