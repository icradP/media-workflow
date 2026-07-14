import { describe, expect, it } from 'vitest';
import { computePresentationAdvanceUs } from '../audio/pcm_ring_bridge.js';

describe('computePresentationAdvanceUs', () => {
  it('realtime advances by wall time × rate (PTS clock)', () => {
    const result = computePresentationAdvanceUs({
      clockMode: 'realtime',
      targetFrameRate: 30,
      rate: 1,
      wallStepUs: 40_000,
      fixedRateCarryUs: 0,
    });
    expect(result.advanceUs).toBe(40_000);
    expect(result.nextCarryUs).toBe(0);
  });

  it('realtime respects playback rate', () => {
    const result = computePresentationAdvanceUs({
      clockMode: 'realtime',
      targetFrameRate: 0,
      rate: 2,
      wallStepUs: 20_000,
      fixedRateCarryUs: 0,
    });
    expect(result.advanceUs).toBe(40_000);
  });

  it('fixed_rate waits until a full frame period has accrued', () => {
    const first = computePresentationAdvanceUs({
      clockMode: 'fixed_rate',
      targetFrameRate: 30,
      rate: 1,
      wallStepUs: 10_000,
      fixedRateCarryUs: 0,
    });
    expect(first.advanceUs).toBe(0);
    expect(first.nextCarryUs).toBe(10_000);

    const second = computePresentationAdvanceUs({
      clockMode: 'fixed_rate',
      targetFrameRate: 30,
      rate: 1,
      wallStepUs: 25_000,
      fixedRateCarryUs: first.nextCarryUs,
    });
    // 33_333µs @ 30fps
    expect(second.advanceUs).toBe(33_333);
    expect(second.nextCarryUs).toBe(10_000 + 25_000 - 33_333);
  });

  it('fixed_rate can emit multiple ticks when catching up', () => {
    const result = computePresentationAdvanceUs({
      clockMode: 'fixed_rate',
      targetFrameRate: 30,
      rate: 1,
      wallStepUs: 100_000,
      fixedRateCarryUs: 0,
    });
    expect(result.advanceUs).toBe(33_333 * 3);
  });
});
