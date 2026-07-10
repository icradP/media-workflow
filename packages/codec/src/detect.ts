/**
 * Container format detection via magic bytes.
 */

export type DetectedFormat = 'flv' | 'mpegts' | 'mpegps' | 'mp4' | 'wav' | 'flac' | 'mp3' | 'opus' | 'unknown';

/** FLV signature: first 3 bytes = "FLV" */
export function isFlvSignature(data: Uint8Array): boolean {
  return data.length >= 3 && data[0] === 0x46 && data[1] === 0x4c && data[2] === 0x56;
}

/** WAV signature: "RIFF" + "WAVE" */
export function isWavSignature(data: Uint8Array): boolean {
  return data.length >= 12 &&
    data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 &&
    data[8] === 0x57 && data[9] === 0x41 && data[10] === 0x56 && data[11] === 0x45;
}

/** MP4/fMP4: box size + "ftyp" at offset 4 */
export function isMp4OrFmp4Signature(data: Uint8Array): boolean {
  return data.length >= 12 &&
    data[4] === 0x66 && data[5] === 0x74 && data[6] === 0x79 && data[7] === 0x70;
}

/** MPEG-TS: sync byte 0x47 every 188 bytes */
export function detectMpegTsPacketSize(data: Uint8Array): number | null {
  if (data.length < 188) return null;
  if (data[0] === 0x47) {
    // Check if every 188-byte boundary has sync byte
    let ok = true;
    for (let i = 188; i < Math.min(data.length, 188 * 5); i += 188) {
      if (data[i] !== 0x47) { ok = false; break; }
    }
    if (ok) return 188;
  }
  return null;
}

/** FLAC: "fLaC" marker */
export function isFlacSignature(data: Uint8Array): boolean {
  return data.length >= 4 &&
    data[0] === 0x66 && data[1] === 0x4c && data[2] === 0x61 && data[3] === 0x43;
}

/** MP3: sync word 0xFFE0 (11 bits) */
export function isMp3Signature(data: Uint8Array): boolean {
  const hasId3 = data.length >= 3 &&
    data[0] === 0x49 &&
    data[1] === 0x44 &&
    data[2] === 0x33;
  return hasId3 ||
    (data.length >= 2 && data[0] === 0xff && ((data[1]! & 0xe0) === 0xe0));
}

/** Opus: "OpusHead" */
export function isOggOpusSignature(data: Uint8Array): boolean {
  return data.length >= 36 &&
    data[0] === 0x4f && data[1] === 0x67 && data[2] === 0x67 && data[3] === 0x53 && // "OggS"
    data[28] === 0x4f && data[29] === 0x70 && data[30] === 0x75 && data[31] === 0x73; // "Opus"
}

/** PS pack header: 00 00 01 BA */
export function isPsPackHeader(data: Uint8Array): boolean {
  return data.length >= 4 &&
    data[0] === 0x00 && data[1] === 0x00 && data[2] === 0x01 && data[3] === 0xBA;
}

export function detectContainerFormat(data: Uint8Array): DetectedFormat {
  if (isFlvSignature(data)) return 'flv';
  if (isMp4OrFmp4Signature(data)) return 'mp4';
  if (detectMpegTsPacketSize(data)) return 'mpegts';
  if (isPsPackHeader(data)) return 'mpegps';
  if (isWavSignature(data)) return 'wav';
  if (isFlacSignature(data)) return 'flac';
  if (isMp3Signature(data)) return 'mp3';
  if (isOggOpusSignature(data)) return 'opus';
  return 'unknown';
}
