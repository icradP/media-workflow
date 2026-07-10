/**
 * AAC / MPEG-4 Audio constants.
 */

export const AAC_SAMPLING_FREQUENCIES = [
  96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000,
  7350, 0, 0, 0,
];

export const AUDIO_OBJECT_TYPE_NAMES: Record<number, string> = {
  0: 'NULL', 1: 'AAC Main', 2: 'AAC LC (Low Complexity)',
  3: 'AAC SSR', 4: 'AAC LTP', 5: 'SBR', 6: 'AAC Scalable',
  17: 'ER AAC LC', 19: 'ER AAC LTP', 20: 'ER AAC Scalable',
  22: 'ER BSAC', 23: 'ER AAC LD', 29: 'PS (Parametric Stereo)',
  42: 'USAC (no SBR)', 45: 'USAC',
};

export const AAC_PROFILE_ID_NAMES: Record<number, string> = {
  0: 'Main', 1: 'LC (Low Complexity)', 2: 'SSR', 3: 'LTP',
  4: 'SBR (HE-AAC)', 5: 'Scalable',
};

export function getAudioObjectTypeName(aot: number): string {
  return AUDIO_OBJECT_TYPE_NAMES[aot] ?? `Unknown (${aot})`;
}

export function getAacRiProfileName(idx: number): string {
  return AAC_PROFILE_ID_NAMES[idx - 1] ?? `Unknown (${idx})`;
}

export function getChannelLayoutLabel(ch: number): string {
  const map: Record<number, string> = {
    0: 'Defined in AOT', 1: 'Mono', 2: 'Stereo', 3: '3.0',
    4: '4.0', 5: '5.0', 6: '5.1', 7: '7.1',
  };
  return map[ch] ?? `${ch} channels`;
}
