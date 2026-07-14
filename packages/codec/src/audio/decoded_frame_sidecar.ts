import type { DecodedVideoFrame, EncodedPacket } from '@media-workflow/core';

/**
 * Side-car decoded-frame cache keyed for TimedPacketRing clock packets.
 * Packet ring advances pts; this map resolves paintables without resizing the ring API.
 */
export class DecodedFrameSidecar {
  private readonly bySampleId = new Map<string, DecodedVideoFrame>();
  private readonly byPtsUs = new Map<number, DecodedVideoFrame>();
  private readonly byPacketId = new Map<string, DecodedVideoFrame>();

  size(): number {
    return this.bySampleId.size;
  }

  clear(): void {
    this.bySampleId.clear();
    this.byPtsUs.clear();
    this.byPacketId.clear();
  }

  /** Index frames for lookup by sourceSampleId / pts / optional packetId. */
  fill(frames: DecodedVideoFrame[], packetIds?: string[]): void {
    this.clear();
    for (let index = 0; index < frames.length; index++) {
      const frame = frames[index]!;
      this.bySampleId.set(frame.sourceSampleId, frame);
      this.byPtsUs.set(frame.ptsUs, frame);
      const packetId = packetIds?.[index] ?? `clock:${frame.frameId}`;
      this.byPacketId.set(packetId, frame);
    }
  }

  set(packetId: string, frame: DecodedVideoFrame): void {
    this.byPacketId.set(packetId, frame);
    this.bySampleId.set(frame.sourceSampleId, frame);
    this.byPtsUs.set(frame.ptsUs, frame);
  }

  resolve(packet: EncodedPacket): DecodedVideoFrame | undefined {
    return this.byPacketId.get(packet.packetId)
      ?? this.bySampleId.get(packet.sourceSampleId)
      ?? this.byPtsUs.get(packet.ptsUs);
  }

  resolveMany(packets: EncodedPacket[]): DecodedVideoFrame[] {
    const frames: DecodedVideoFrame[] = [];
    for (const packet of packets) {
      const frame = this.resolve(packet);
      if (frame) frames.push(frame);
    }
    return frames;
  }
}

/** Build empty clock packets so TimedPacketRing can pace decoded frames by pts. */
export function clockPacketsFromDecodedFrames(
  frames: DecodedVideoFrame[],
): EncodedPacket[] {
  const sorted = [...frames].sort((a, b) => a.ptsUs - b.ptsUs);
  return sorted.map(frame => {
    const durationUs = frame.durationUs
      ?? inferDurationUs(sorted, frame);
    return {
      packetId: `clock:${frame.frameId}`,
      sourceSampleId: frame.sourceSampleId,
      trackId: 'decoded_video',
      codecFamily: 'h264',
      bitstreamFormat: 'avcc',
      data: new Uint8Array(0),
      ptsUs: frame.ptsUs,
      dtsUs: frame.ptsUs,
      durationUs,
      isKey: true,
      metadata: { clockOnly: true, frameId: frame.frameId },
    };
  });
}

function inferDurationUs(
  sorted: DecodedVideoFrame[],
  frame: DecodedVideoFrame,
): number {
  const index = sorted.findIndex(candidate => candidate.frameId === frame.frameId);
  const next = index >= 0 ? sorted[index + 1] : undefined;
  if (next) return Math.max(1, next.ptsUs - frame.ptsUs);
  if (index > 0) {
    const prev = sorted[index - 1]!;
    return Math.max(1, frame.ptsUs - prev.ptsUs);
  }
  return 33_333;
}
