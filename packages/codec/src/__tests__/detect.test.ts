import { describe, it, expect } from 'vitest';
import {
  isFlvSignature,
  isWavSignature,
  isFlacSignature,
  isMp3Signature,
  isOggOpusSignature,
  isPsPackHeader,
  isMp4OrFmp4Signature,
  detectContainerFormat,
  detectMpegTsPacketSize,
} from '../detect';

// ─── Magic byte tests ───

describe('isFlvSignature', () => {
  it('detects FLV header', () => {
    const flv = new Uint8Array([0x46, 0x4c, 0x56, 0x01, 0x05, 0x00, 0x00, 0x00, 0x09]);
    expect(isFlvSignature(flv)).toBe(true);
  });

  it('rejects non-FLV data', () => {
    expect(isFlvSignature(new Uint8Array([0x00, 0x00, 0x01]))).toBe(false);
    expect(isFlvSignature(new Uint8Array([]))).toBe(false);
  });
});

describe('isWavSignature', () => {
  it('detects WAV header', () => {
    const wav = new Uint8Array(44);
    wav.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
    wav.set([0x57, 0x41, 0x56, 0x45], 8); // "WAVE"
    expect(isWavSignature(wav)).toBe(true);
  });

  it('rejects non-WAV', () => {
    expect(isWavSignature(new Uint8Array([0x46, 0x4c, 0x56]))).toBe(false);
  });
});

describe('isFlacSignature', () => {
  it('detects FLAC marker', () => {
    const flac = new Uint8Array([0x66, 0x4c, 0x61, 0x43]);
    expect(isFlacSignature(flac)).toBe(true);
  });
});

describe('isMp3Signature', () => {
  it('detects MP3 sync word', () => {
    const mp3 = new Uint8Array([0xff, 0xfb, 0x90, 0x00]);
    expect(isMp3Signature(mp3)).toBe(true);
  });

  it('rejects non-MP3', () => {
    expect(isMp3Signature(new Uint8Array([0x00, 0x00]))).toBe(false);
  });
});

describe('isMp4OrFmp4Signature', () => {
  it('detects ftyp box', () => {
    const mp4 = new Uint8Array(12);
    mp4.set([0x00, 0x00, 0x00, 0x0c, 0x66, 0x74, 0x79, 0x70], 0); // size=12, "ftyp"
    expect(isMp4OrFmp4Signature(mp4)).toBe(true);
  });
});

describe('isPsPackHeader', () => {
  it('detects PS pack header', () => {
    const ps = new Uint8Array([0x00, 0x00, 0x01, 0xBA]);
    expect(isPsPackHeader(ps)).toBe(true);
  });
});

describe('detectMpegTsPacketSize', () => {
  it('detects 188-byte TS packets', () => {
    const ts = new Uint8Array(188 * 3);
    for (let i = 0; i < ts.length; i += 188) ts[i] = 0x47;
    expect(detectMpegTsPacketSize(ts)).toBe(188);
  });

  it('returns null for non-TS data', () => {
    expect(detectMpegTsPacketSize(new Uint8Array(100))).toBeNull();
  });
});

describe('detectContainerFormat', () => {
  it('detects FLV', () => {
    const flv = new Uint8Array([0x46, 0x4c, 0x56, 0x01, 0x05, 0x00, 0x00, 0x00, 0x09]);
    expect(detectContainerFormat(flv)).toBe('flv');
  });

  it('returns unknown for empty/garbage', () => {
    expect(detectContainerFormat(new Uint8Array([]))).toBe('unknown');
    expect(detectContainerFormat(new Uint8Array([0x00, 0x00, 0x00, 0x00]))).toBe('unknown');
  });
});
