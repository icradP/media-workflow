import { describe, expect, it } from 'vitest';
import type { DecodedVideoFrame } from '@media-workflow/core';
import {
  clockPacketsFromDecodedFrames,
  DecodedFrameSidecar,
} from '../audio/decoded_frame_sidecar.js';
import { TimedPacketRing } from '../audio/pcm_sample_ring.js';

function frame(ptsUs: number, id: string): DecodedVideoFrame {
  const width = 2;
  const height = 2;
  return {
    frameId: id,
    sourceSampleId: id,
    ptsUs,
    durationUs: 40_000,
    codedWidth: width,
    codedHeight: height,
    displayWidth: width,
    displayHeight: height,
    format: 'I420',
    planes: [
      new Uint8Array(width * height),
      new Uint8Array(1),
      new Uint8Array(1),
    ],
    strides: [width, 1, 1],
    metadata: {},
  };
}

describe('DecodedFrameSidecar', () => {
  it('resolves due frames via TimedPacketRing clock packets', () => {
    const frames = [frame(0, 'a'), frame(40_000, 'b'), frame(80_000, 'c')];
    const packets = clockPacketsFromDecodedFrames(frames);
    const ring = new TimedPacketRing({ capacity: 16, underrunPolicy: 'wait', loop: false });
    ring.fill(packets);

    const sidecar = new DecodedFrameSidecar();
    sidecar.fill(frames, packets.map(packet => packet.packetId));

    const due = ring.pullDue(45_000);
    expect(due.map(packet => packet.sourceSampleId)).toEqual(['a', 'b']);
    expect(sidecar.resolveMany(due).map(item => item.frameId)).toEqual(['a', 'b']);
  });

  it('synthesizes empty clock packets with pts / duration', () => {
    const packets = clockPacketsFromDecodedFrames([
      frame(0, 'a'),
      frame(33_333, 'b'),
    ]);
    expect(packets).toHaveLength(2);
    expect(packets[0]?.data.byteLength).toBe(0);
    expect(packets[0]?.metadata.clockOnly).toBe(true);
    expect(packets[1]?.ptsUs).toBe(33_333);
  });

  it('static preload keeps all clock packets even when capacitySeconds is small', () => {
    const frames = Array.from({ length: 200 }, (_, index) =>
      frame(index * 33_333, `f${index}`));
    const packets = clockPacketsFromDecodedFrames(frames);
    const ring = new TimedPacketRing({
      capacity: Math.max(
        Math.floor(1 * 30),
        packets.length,
      ),
      underrunPolicy: 'wait',
      overrunPolicy: 'drop_newest',
      loop: false,
    });
    expect(ring.fill(packets)).toBe(200);
    expect(ring.size()).toBe(200);
  });
});
