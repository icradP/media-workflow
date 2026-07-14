import type {
  DecodedVideoFrame,
  DecodedVideoPixelFormat,
  DecoderConfig,
  EncodedPacket,
} from '@media-workflow/core';
import { adaptPacketForDecoder } from '../decode/bitstream.js';
import { copyVideoFrame, isWebCodecsAvailable } from '../decode/yuv.js';

export interface StreamingVideoDecoderOptions {
  decoderConfig: DecoderConfig;
  /** Max decoded frames retained (presentation window). */
  capacityFrames: number;
  /** Decode this far ahead of presentation clock. */
  lookaheadUs: number;
  outputFormat?: DecodedVideoPixelFormat;
}

/**
 * Live WebCodecs video decoder paced by a presentation clock.
 * Holds the full encoded packet list; only a short decoded frame window stays in memory.
 */
export class StreamingVideoDecoder {
  private readonly decoderConfig: DecoderConfig;
  private readonly capacityFrames: number;
  private readonly lookaheadUs: number;
  private readonly outputFormat: DecodedVideoPixelFormat;
  private readonly chunkFormat: 'avcc' | 'annexb';

  private packets: EncodedPacket[] = [];
  private feedIndex = 0;
  private decoder: VideoDecoder | null = null;
  private frames: DecodedVideoFrame[] = [];
  private copyQueue: Promise<void> = Promise.resolve();
  private closed = false;
  private decodeError: Error | null = null;

  constructor(options: StreamingVideoDecoderOptions) {
    this.decoderConfig = options.decoderConfig;
    this.capacityFrames = Math.max(2, Math.floor(options.capacityFrames));
    this.lookaheadUs = Math.max(33_333, Math.floor(options.lookaheadUs));
    this.outputFormat = options.outputFormat ?? 'I420';
    this.chunkFormat = this.decoderConfig.bitstreamFormat === 'annexb' ? 'annexb' : 'avcc';
  }

  setPackets(packets: EncodedPacket[]): void {
    this.packets = [...packets].sort((a, b) =>
      a.dtsUs - b.dtsUs || a.ptsUs - b.ptsUs || a.packetId.localeCompare(b.packetId),
    );
    this.feedIndex = 0;
  }

  packetCount(): number {
    return this.packets.length;
  }

  decodedCount(): number {
    return this.frames.length;
  }

  firstPtsUs(): number {
    if (this.packets.length === 0) return 0;
    return Math.min(...this.packets.map(packet => packet.ptsUs));
  }

  lastPtsUs(): number {
    if (this.packets.length === 0) return 0;
    return Math.max(...this.packets.map(packet => packet.ptsUs));
  }

  lastError(): Error | null {
    return this.decodeError;
  }

  /** Feed packets up to clock+lookahead; drop old decoded frames. */
  async tick(presentationClockUs: number): Promise<void> {
    if (this.closed) return;
    if (!isWebCodecsAvailable()) {
      this.decodeError = new Error('StreamingVideoDecoder: WebCodecs is not available');
      return;
    }
    this.ensureDecoder();
    const decoder = this.decoder;
    if (!decoder || decoder.state === 'closed') return;

    const targetUs = presentationClockUs + this.lookaheadUs;
    while (this.feedIndex < this.packets.length) {
      // Keep WebCodecs backlog bounded — unrestricted decode() freezes/errors mid-clip.
      if (typeof decoder.decodeQueueSize === 'number' && decoder.decodeQueueSize >= 8) {
        break;
      }
      const packet = this.packets[this.feedIndex]!;
      // Feed by decode timestamp; also allow pts within lookahead for B-frame streams.
      if (packet.dtsUs > targetUs && packet.ptsUs > targetUs) break;
      try {
        const payload = adaptPacketForDecoder(
          packet.data,
          packet.bitstreamFormat,
          this.chunkFormat,
        );
        decoder.decode(new EncodedVideoChunk({
          type: packet.isKey ? 'key' : 'delta',
          timestamp: packet.ptsUs,
          duration: packet.durationUs,
          data: payload,
        }));
      } catch (error) {
        this.decodeError = error instanceof Error ? error : new Error(String(error));
        break;
      }
      this.feedIndex++;
    }

    // Yield so VideoDecoder output callbacks can land, then finish pending copies.
    await Promise.resolve();
    await this.copyQueue;
    this.trimFrames(presentationClockUs);
  }

  /** Latest decoded frame with pts <= clock (or nearest early frame). */
  pullPresentable(presentationClockUs: number): DecodedVideoFrame | undefined {
    if (this.frames.length === 0) return undefined;
    let best: DecodedVideoFrame | undefined;
    for (const frame of this.frames) {
      if (frame.ptsUs <= presentationClockUs) {
        if (!best || frame.ptsUs >= best.ptsUs) best = frame;
      }
    }
    return best ?? this.frames[0];
  }

  async resetForLoop(): Promise<void> {
    await this.teardownDecoder();
    this.feedIndex = 0;
    this.frames = [];
    this.decodeError = null;
    this.ensureDecoder();
  }

  stop(): void {
    this.closed = true;
    void this.teardownDecoder();
    this.frames = [];
  }

  private ensureDecoder(): void {
    if (this.closed || this.decoder) return;
    if (!isWebCodecsAvailable()) return;

    const decoder = new VideoDecoder({
      output: frame => {
        const sampleId = `pts:${frame.timestamp}`;
        const clone = frame.clone();
        frame.close();
        this.copyQueue = this.copyQueue
          .then(async () => {
            if (this.closed) {
              clone.close();
              return;
            }
            try {
              const decoded = await copyVideoFrame(clone, sampleId, this.outputFormat);
              this.pushFrame(decoded);
            } catch (error) {
              this.decodeError = error instanceof Error ? error : new Error(String(error));
            } finally {
              clone.close();
            }
          })
          .catch(error => {
            this.decodeError = error instanceof Error ? error : new Error(String(error));
          });
      },
      error: error => {
        this.decodeError = error;
      },
    });

    decoder.configure({
      codec: this.decoderConfig.codec,
      description: this.decoderConfig.description,
      codedWidth: this.decoderConfig.codedWidth,
      codedHeight: this.decoderConfig.codedHeight,
    });
    this.decoder = decoder;
  }

  private pushFrame(frame: DecodedVideoFrame): void {
    this.frames.push(frame);
    this.frames.sort((a, b) => a.ptsUs - b.ptsUs);
    while (this.frames.length > this.capacityFrames) {
      this.frames.shift();
    }
  }

  private trimFrames(presentationClockUs: number): void {
    // Keep a little past history so pullPresentable stays smooth.
    const keepBeforeUs = presentationClockUs - this.lookaheadUs;
    while (this.frames.length > 1 && (this.frames[0]?.ptsUs ?? 0) < keepBeforeUs) {
      this.frames.shift();
    }
    while (this.frames.length > this.capacityFrames) {
      this.frames.shift();
    }
  }

  private async teardownDecoder(): Promise<void> {
    const decoder = this.decoder;
    this.decoder = null;
    if (!decoder) return;
    try {
      if (decoder.state === 'configured') await decoder.flush();
    } catch {
      /* ignore */
    }
    try {
      decoder.close();
    } catch {
      /* ignore */
    }
    await this.copyQueue.catch(() => undefined);
  }
}

/** Capacity in frames from seconds × fps (with a small floor). */
export function decodedWindowCapacity(capacitySeconds: number, targetFrameRate: number): number {
  const fps = Math.max(1, targetFrameRate || 30);
  return Math.max(4, Math.ceil(Math.max(0.05, capacitySeconds) * fps));
}
