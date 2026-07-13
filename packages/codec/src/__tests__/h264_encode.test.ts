import { describe, expect, it } from 'vitest';
import { normalizeH264EncoderOutput } from '../encode/h264.js';

describe('normalizeH264EncoderOutput', () => {
  it('leaves valid AVCC packets unchanged even when length prefix looks like Annex-B', () => {
    const nalu = new Uint8Array(256).fill(0xab);
    const avcc = new Uint8Array(4 + nalu.length);
    avcc[0] = 0x00;
    avcc[1] = 0x00;
    avcc[2] = 0x01;
    avcc[3] = 0x00;
    avcc.set(nalu, 4);

    const normalized = normalizeH264EncoderOutput(avcc);
    expect(normalized).toBe(avcc);
  });

  it('converts true Annex-B chunks to AVCC', () => {
    const annexB = new Uint8Array([0x00, 0x00, 0x01, 0x65, 0x88]);
    const normalized = normalizeH264EncoderOutput(annexB);
    expect(normalized[0]).toBe(0);
    expect(normalized[1]).toBe(0);
    expect(normalized[2]).toBe(0);
    expect(normalized[3]).toBe(2);
    expect(normalized[4]).toBe(0x65);
    expect(normalized[5]).toBe(0x88);
  });

  it('leaves small AVCC packets unchanged', () => {
    const avcc = new Uint8Array([0x00, 0x00, 0x00, 0x03, 0x65, 0x88, 0x99]);
    expect(normalizeH264EncoderOutput(avcc)).toBe(avcc);
  });
});
