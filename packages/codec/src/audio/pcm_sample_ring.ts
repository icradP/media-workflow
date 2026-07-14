import type {
  EncodedPacket,
  PcmAudioClip,
  RingOverrunPolicy,
  RingUnderrunPolicy,
} from '@media-workflow/core';

export interface PcmSampleRingOptions {
  capacitySamples: number;
  channels: number;
  underrunPolicy?: RingUnderrunPolicy;
  overrunPolicy?: RingOverrunPolicy;
  /** When underrunPolicy=loop, refill from this static snapshot. */
  loop?: boolean;
}

/**
 * Bounded planar float32 sample ring with underrun / overrun policies.
 */
export class PcmSampleRing {
  readonly capacitySamples: number;
  readonly channels: number;
  underrunPolicy: RingUnderrunPolicy;
  overrunPolicy: RingOverrunPolicy;
  loop: boolean;

  private readonly planes: Float32Array[];
  private writePos = 0;
  private readPos = 0;
  private filled = 0;
  private loopSnapshot: Float32Array[] | null = null;
  private loopLength = 0;
  private loopRead = 0;

  underrunCount = 0;
  overrunCount = 0;

  constructor(options: PcmSampleRingOptions) {
    this.capacitySamples = Math.max(1, Math.floor(options.capacitySamples));
    this.channels = Math.max(1, Math.floor(options.channels));
    this.underrunPolicy = options.underrunPolicy ?? 'silence';
    this.overrunPolicy = options.overrunPolicy ?? 'drop_oldest';
    this.loop = options.loop !== false;
    this.planes = Array.from(
      { length: this.channels },
      () => new Float32Array(this.capacitySamples),
    );
  }

  available(): number {
    return this.filled;
  }

  free(): number {
    return this.capacitySamples - this.filled;
  }

  clear(): void {
    this.writePos = 0;
    this.readPos = 0;
    this.filled = 0;
  }

  /** Store a static snapshot used by underrunPolicy=loop. */
  setLoopSnapshot(planes: Float32Array[], sampleCount: number): void {
    const count = Math.max(0, Math.min(sampleCount, planes[0]?.length ?? 0));
    this.loopLength = count;
    this.loopRead = 0;
    this.loopSnapshot = Array.from({ length: this.channels }, (_, channel) => {
      const src = planes[Math.min(channel, planes.length - 1)] ?? new Float32Array(count);
      return src.slice(0, count);
    });
  }

  /** Prefill from a PCM clip (capped to capacity). */
  fillFromClip(clip: PcmAudioClip): number {
    const channels = Math.min(this.channels, clip.channels, clip.planes.length);
    const count = Math.min(this.capacitySamples, clip.sampleCount);
    const planes = Array.from({ length: this.channels }, (_, channel) => {
      const src = clip.planes[Math.min(channel, channels - 1)] ?? new Float32Array(count);
      return src.subarray(0, count);
    });
    this.clear();
    const written = this.writePlanar(planes, count);
    if (this.loop) this.setLoopSnapshot(planes, count);
    return written;
  }

  /**
   * Write planar samples. Returns samples accepted.
   * Applies overrunPolicy when full.
   */
  writePlanar(planes: ArrayLike<ArrayLike<number>>, sampleCount: number): number {
    let remaining = Math.max(0, Math.floor(sampleCount));
    let srcOffset = 0;
    let written = 0;

    while (remaining > 0) {
      let free = this.free();
      if (free === 0) {
        if (this.overrunPolicy === 'drop_newest') {
          this.overrunCount += remaining;
          break;
        }
        if (this.overrunPolicy === 'block_producer') {
          break;
        }
        // drop_oldest: free up to half capacity or the needed amount
        const drop = Math.min(this.filled, Math.max(remaining, Math.floor(this.capacitySamples / 4)));
        this.discard(drop);
        this.overrunCount += drop;
        free = this.free();
        if (free === 0) break;
      }

      const chunk = Math.min(remaining, free, this.capacitySamples - this.writePos);
      for (let channel = 0; channel < this.channels; channel++) {
        const dest = this.planes[channel]!;
        const src = planes[Math.min(channel, planes.length - 1)]!;
        for (let i = 0; i < chunk; i++) {
          dest[this.writePos + i] = Number(src[srcOffset + i] ?? 0);
        }
      }
      this.writePos = (this.writePos + chunk) % this.capacitySamples;
      this.filled += chunk;
      srcOffset += chunk;
      remaining -= chunk;
      written += chunk;
    }
    return written;
  }

  /**
   * Read planar samples into outPlanes (length >= sampleCount each).
   * Always fills sampleCount output frames (except wait underrun which short-fills trailing zeros
   * and returns the count of frames actually taken from the ring + silence prefix).
   */
  readPlanar(outPlanes: Float32Array[], sampleCount: number, rate = 1): number {
    const frames = Math.max(0, Math.floor(sampleCount));
    const playbackRate = Math.max(0.05, rate);
    let produced = 0;
    let srcCursor = 0; // fractional source advance accumulator

    for (let frame = 0; frame < frames; frame++) {
      while (this.filled <= 0) {
        if (this.underrunPolicy === 'wait') {
          for (let channel = 0; channel < outPlanes.length; channel++) {
            outPlanes[channel]?.fill(0, frame);
          }
          return produced;
        }
        if (this.underrunPolicy === 'silence') {
          this.underrunCount++;
          for (let channel = 0; channel < this.channels; channel++) {
            const out = outPlanes[channel];
            if (out) out[frame] = 0;
          }
          produced++;
          srcCursor = 0;
          break;
        }
        // loop
        if (!this.refillFromLoop()) {
          this.underrunCount++;
          for (let channel = 0; channel < this.channels; channel++) {
            const out = outPlanes[channel];
            if (out) out[frame] = 0;
          }
          produced++;
          break;
        }
      }

      if (this.filled <= 0) continue;

      const idx = this.readPos;
      for (let channel = 0; channel < this.channels; channel++) {
        const out = outPlanes[channel];
        if (out) out[frame] = this.planes[channel]![idx] ?? 0;
      }
      produced++;

      srcCursor += playbackRate;
      const consume = Math.max(1, Math.floor(srcCursor));
      srcCursor -= consume;
      this.discard(Math.min(consume, this.filled));
    }
    return produced;
  }

  private refillFromLoop(): boolean {
    if (!this.loopSnapshot || this.loopLength <= 0) return false;
    this.underrunCount++;
    const free = this.free();
    if (free <= 0) this.discard(Math.min(this.filled, Math.floor(this.capacitySamples / 2)));
    const chunk = Math.min(this.loopLength, this.free());
    if (chunk <= 0) return false;
    const slices = this.loopSnapshot.map(plane => {
      const start = this.loopRead;
      const out = new Float32Array(chunk);
      for (let i = 0; i < chunk; i++) {
        out[i] = plane[(start + i) % this.loopLength] ?? 0;
      }
      return out;
    });
    this.loopRead = (this.loopRead + chunk) % this.loopLength;
    return this.writePlanar(slices, chunk) > 0;
  }

  private discard(count: number): void {
    const n = Math.min(Math.max(0, count), this.filled);
    this.readPos = (this.readPos + n) % this.capacitySamples;
    this.filled -= n;
  }
}

export interface TimedPacketRingOptions {
  capacity: number;
  underrunPolicy?: RingUnderrunPolicy;
  overrunPolicy?: RingOverrunPolicy;
  loop?: boolean;
}

/**
 * Bounded packet queue ordered by pts. Used for encoded / decoded frame clocking.
 */
export class TimedPacketRing {
  readonly capacity: number;
  underrunPolicy: RingUnderrunPolicy;
  overrunPolicy: RingOverrunPolicy;
  loop: boolean;

  private readonly queue: EncodedPacket[] = [];
  private loopSnapshot: EncodedPacket[] = [];
  private loopIndex = 0;
  private clockUs = 0;

  underrunCount = 0;
  overrunCount = 0;

  constructor(options: TimedPacketRingOptions) {
    this.capacity = Math.max(1, Math.floor(options.capacity));
    this.underrunPolicy = options.underrunPolicy ?? 'wait';
    this.overrunPolicy = options.overrunPolicy ?? 'drop_oldest';
    this.loop = options.loop !== false;
  }

  size(): number {
    return this.queue.length;
  }

  clear(): void {
    this.queue.length = 0;
    this.clockUs = 0;
  }

  fill(packets: EncodedPacket[]): number {
    this.clear();
    const sorted = [...packets].sort((a, b) => a.ptsUs - b.ptsUs);
    this.loopSnapshot = this.loop ? sorted.map(p => ({ ...p, data: p.data.slice() })) : [];
    this.loopIndex = 0;
    let written = 0;
    for (const packet of sorted) {
      if (!this.push(packet)) break;
      written++;
    }
    if (sorted[0]) this.clockUs = sorted[0].ptsUs;
    return written;
  }

  push(packet: EncodedPacket): boolean {
    if (this.queue.length >= this.capacity) {
      if (this.overrunPolicy === 'drop_newest') {
        this.overrunCount++;
        return false;
      }
      if (this.overrunPolicy === 'block_producer') return false;
      this.queue.shift();
      this.overrunCount++;
    }
    this.queue.push(packet);
    return true;
  }

  /** Advance media clock by deltaUs; return packets whose pts <= clock. */
  pullDue(deltaUs: number): EncodedPacket[] {
    this.clockUs += Math.max(0, deltaUs);
    const due: EncodedPacket[] = [];
    while (this.queue.length > 0 && this.queue[0]!.ptsUs <= this.clockUs) {
      due.push(this.queue.shift()!);
    }
    if (due.length === 0 && this.queue.length === 0) {
      this.underrunCount++;
      if (this.underrunPolicy === 'loop' && this.loopSnapshot.length > 0) {
        const packet = this.loopSnapshot[this.loopIndex % this.loopSnapshot.length]!;
        this.loopIndex++;
        // Rebase loop packet pts relative to current clock
        const duration = packet.durationUs ?? 33_333;
        const rebased: EncodedPacket = {
          ...packet,
          data: packet.data.slice(),
          ptsUs: this.clockUs,
          dtsUs: this.clockUs,
          durationUs: duration,
        };
        due.push(rebased);
        this.clockUs += duration;
      }
    }
    return due;
  }

  peekClockUs(): number {
    return this.clockUs;
  }
}
