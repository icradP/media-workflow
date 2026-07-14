import { describe, expect, it } from 'vitest';
import type { EncodedPacket, PcmAudioClip } from '@media-workflow/core';
import { PcmSampleRing, TimedPacketRing } from '../audio/pcm_sample_ring.js';

function tone(sampleCount = 480, channels = 1): PcmAudioClip {
  return {
    clipId: 't',
    sourceTrackId: 'a0',
    ptsUs: 0,
    durationUs: Math.round((sampleCount / 48_000) * 1_000_000),
    sampleRate: 48_000,
    channels,
    sampleCount,
    format: 'f32-planar',
    planes: Array.from({ length: channels }, () =>
      Float32Array.from({ length: sampleCount }, (_, i) => Math.sin(i / 10) * 0.2)),
    backend: {
      id: 'test',
      version: '0',
      api: 'mock',
      codecFamilies: [],
      inputFormats: [],
      outputFormats: ['f32-planar'],
    },
    diagnostics: [],
  };
}

function packet(ptsUs: number, id: string): EncodedPacket {
  return {
    packetId: id,
    sourceSampleId: id,
    trackId: 'v0',
    codecFamily: 'h264',
    bitstreamFormat: 'avcc',
    data: new Uint8Array([0, 0, 0, 1, 0x65]),
    ptsUs,
    dtsUs: ptsUs,
    durationUs: 33_333,
    isKey: true,
    metadata: {},
  };
}

describe('PcmSampleRing', () => {
  it('fills from clip up to capacity and reports available', () => {
    const ring = new PcmSampleRing({
      capacitySamples: 100,
      channels: 1,
      underrunPolicy: 'silence',
      overrunPolicy: 'drop_oldest',
      loop: true,
    });
    const written = ring.fillFromClip(tone(480));
    expect(written).toBe(100);
    expect(ring.available()).toBe(100);
  });

  it('overrun drop_oldest frees space for new writes', () => {
    const ring = new PcmSampleRing({
      capacitySamples: 8,
      channels: 1,
      overrunPolicy: 'drop_oldest',
    });
    const first = new Float32Array([1, 1, 1, 1, 1, 1, 1, 1]);
    ring.writePlanar([first], 8);
    const second = new Float32Array([2, 2, 2, 2]);
    const written = ring.writePlanar([second], 4);
    expect(written).toBe(4);
    expect(ring.overrunCount).toBeGreaterThan(0);
    expect(ring.available()).toBe(8);
  });

  it('overrun drop_newest rejects when full', () => {
    const ring = new PcmSampleRing({
      capacitySamples: 4,
      channels: 1,
      overrunPolicy: 'drop_newest',
    });
    ring.writePlanar([new Float32Array([1, 1, 1, 1])], 4);
    const written = ring.writePlanar([new Float32Array([9, 9])], 2);
    expect(written).toBe(0);
    expect(ring.overrunCount).toBe(2);
  });

  it('underrun silence fills zeros and continues', () => {
    const ring = new PcmSampleRing({
      capacitySamples: 4,
      channels: 1,
      underrunPolicy: 'silence',
    });
    ring.writePlanar([new Float32Array([0.5, 0.5])], 2);
    const out = [new Float32Array(4)];
    const produced = ring.readPlanar(out, 4, 1);
    expect(produced).toBe(4);
    expect(out[0]![0]).toBeCloseTo(0.5);
    expect(out[0]![2]).toBe(0);
    expect(ring.underrunCount).toBeGreaterThan(0);
  });

  it('underrun loop refills from snapshot', () => {
    const ring = new PcmSampleRing({
      capacitySamples: 4,
      channels: 1,
      underrunPolicy: 'loop',
      loop: true,
    });
    ring.fillFromClip(tone(4));
    const out = [new Float32Array(8)];
    ring.readPlanar(out, 8, 1);
    expect(ring.underrunCount).toBeGreaterThan(0);
    // After loop refill, should have non-zero values beyond original length
    expect(Math.abs(out[0]![5] ?? 0) + Math.abs(out[0]![6] ?? 0)).toBeGreaterThan(0);
  });

  it('underrun wait short-fills', () => {
    const ring = new PcmSampleRing({
      capacitySamples: 4,
      channels: 1,
      underrunPolicy: 'wait',
    });
    ring.writePlanar([new Float32Array([1, 1])], 2);
    const out = [new Float32Array(4)];
    const produced = ring.readPlanar(out, 4, 1);
    expect(produced).toBe(2);
    expect(out[0]![3]).toBe(0);
  });
});

describe('TimedPacketRing', () => {
  it('pulls packets by pts clock', () => {
    const ring = new TimedPacketRing({ capacity: 16, underrunPolicy: 'wait' });
    ring.fill([packet(0, 'a'), packet(40_000, 'b'), packet(80_000, 'c')]);
    expect(ring.pullDue(10_000).map(p => p.packetId)).toEqual(['a']);
    expect(ring.pullDue(35_000).map(p => p.packetId)).toEqual(['b']);
  });

  it('overrun drop_oldest discards front', () => {
    const ring = new TimedPacketRing({ capacity: 2, overrunPolicy: 'drop_oldest' });
    ring.push(packet(0, 'a'));
    ring.push(packet(1, 'b'));
    expect(ring.push(packet(2, 'c'))).toBe(true);
    expect(ring.size()).toBe(2);
    expect(ring.overrunCount).toBe(1);
  });

  it('loop underrun re-emits snapshot packet', () => {
    const ring = new TimedPacketRing({
      capacity: 4,
      underrunPolicy: 'loop',
      loop: true,
    });
    ring.fill([packet(0, 'a')]);
    ring.pullDue(10_000); // drain
    const due = ring.pullDue(1_000);
    expect(due).toHaveLength(1);
    expect(due[0]?.packetId).toBe('a');
    expect(ring.underrunCount).toBeGreaterThan(0);
  });
});
