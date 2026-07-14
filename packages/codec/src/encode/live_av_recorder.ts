import type { DecodedVideoFrame, MediaFile } from '@media-workflow/core';
import { muxEncodedTracksToMp4 } from '../mp4/mux.js';
import {
  decodedFrameToVideoFrame,
  isWebCodecsH264EncoderAvailable,
  normalizeH264EncoderOutput,
} from './h264.js';
import { isWebCodecsAacEncoderAvailable } from './aac.js';

export interface LiveAvRecorderOptions {
  width: number;
  height: number;
  sampleRate: number;
  channels: number;
  videoBitrate?: number;
  audioBitrate?: number;
  fileName?: string;
  framerate?: number;
}

export interface LiveAvRecorder {
  readonly recording: boolean;
  pushVideoFrame(frame: DecodedVideoFrame): void;
  pushPcmInterleaved(
    interleaved: Float32Array,
    sampleRate: number,
    channels: number,
    ptsUs: number,
  ): void;
  stop(): Promise<MediaFile>;
  abort(): void;
}

interface PendingPacket {
  data: Uint8Array;
  ptsUs: number;
  dtsUs: number;
  durationUs: number;
  isKey: boolean;
}

/**
 * Streaming H.264 + AAC encode → progressive MP4 finalize (Live record session).
 */
export function createLiveAvRecorder(options: LiveAvRecorderOptions): LiveAvRecorder {
  if (!isWebCodecsH264EncoderAvailable()) {
    throw new Error('Live record: WebCodecs VideoEncoder unavailable');
  }
  if (!isWebCodecsAacEncoderAvailable()) {
    throw new Error('Live record: WebCodecs AudioEncoder unavailable');
  }

  const width = Math.max(16, Math.round(options.width) || 640) & ~1;
  const height = Math.max(16, Math.round(options.height) || 480) & ~1;
  const sampleRate = Math.max(8_000, Math.round(options.sampleRate) || 48_000);
  const channels = Math.max(1, Math.min(2, Math.round(options.channels) || 1));
  const framerate = Math.max(1, Math.round(Number(options.framerate) || 30));
  const videoBitrate = Math.max(250_000, Number(options.videoBitrate) || 2_000_000);
  const audioBitrate = Math.max(32_000, Number(options.audioBitrate) || 128_000);
  const fileName = String(options.fileName || 'live-capture.mp4');

  const videoPackets: PendingPacket[] = [];
  const audioPackets: PendingPacket[] = [];
  let videoConfig: Uint8Array | undefined;
  let audioConfig: Uint8Array | undefined;
  let videoCodec = 'avc1.42E01E';
  let audioCodec = 'mp4a.40.2';
  let closed = false;
  let basePtsUs: number | null = null;

  const videoEncoder = new VideoEncoder({
    output: (chunk, metadata) => {
      const description = metadata?.decoderConfig?.description;
      if (description) {
        videoConfig = new Uint8Array(description as ArrayBuffer);
        videoCodec = metadata?.decoderConfig?.codec ?? videoCodec;
      }
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      const timestamp = Math.round(chunk.timestamp);
      videoPackets.push({
        data: normalizeH264EncoderOutput(data),
        ptsUs: timestamp,
        dtsUs: timestamp,
        durationUs: Math.max(1, Math.round(chunk.duration ?? 1_000_000 / framerate)),
        isKey: chunk.type === 'key',
      });
    },
    error: error => {
      closed = true;
      throw error;
    },
  });
  videoEncoder.configure({
    codec: 'avc1.42E01E',
    width,
    height,
    bitrate: videoBitrate,
    framerate,
    avc: { format: 'avc' },
  } as VideoEncoderConfig);

  const audioEncoder = new AudioEncoder({
    output: (chunk, metadata) => {
      const description = metadata?.decoderConfig?.description;
      if (description) {
        audioConfig = new Uint8Array(description as ArrayBuffer);
        audioCodec = metadata?.decoderConfig?.codec ?? audioCodec;
      }
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      audioPackets.push({
        data: stripAdtsIfPresent(data),
        ptsUs: Math.round(chunk.timestamp),
        dtsUs: Math.round(chunk.timestamp),
        durationUs: Math.max(1, Math.round(chunk.duration ?? 0)),
        isKey: chunk.type === 'key',
      });
    },
    error: error => {
      closed = true;
      throw error;
    },
  });
  audioEncoder.configure({
    codec: 'mp4a.40.2',
    sampleRate,
    numberOfChannels: channels,
    bitrate: audioBitrate,
  });

  let videoIndex = 0;
  let pcmCarry = new Float32Array(0);

  return {
    get recording() {
      return !closed;
    },

    pushVideoFrame(frame) {
      if (closed || videoEncoder.state !== 'configured') return;
      if (basePtsUs === null) basePtsUs = frame.ptsUs;
      const relativePts = Math.max(0, frame.ptsUs - (basePtsUs ?? 0));
      const keyed = { ...frame, ptsUs: relativePts };
      const videoFrame = decodedFrameToVideoFrame(keyed);
      try {
        videoEncoder.encode(videoFrame, { keyFrame: videoIndex === 0 || videoIndex % (framerate * 2) === 0 });
        videoIndex += 1;
      } finally {
        videoFrame.close();
      }
    },

    pushPcmInterleaved(interleaved, inputRate, inputChannels, ptsUs) {
      if (closed || audioEncoder.state !== 'configured') return;
      if (basePtsUs === null) basePtsUs = ptsUs;
      const ch = Math.max(1, Math.min(2, inputChannels));
      if (inputRate !== sampleRate || ch !== channels) {
        // Live path expects capture rate to match AudioContext; skip mismatched chunks.
        return;
      }
      const merged = new Float32Array(pcmCarry.length + interleaved.length);
      merged.set(pcmCarry, 0);
      merged.set(interleaved, pcmCarry.length);
      const frameSize = 1024;
      let offset = 0;
      while (offset + frameSize * channels <= merged.length) {
        const slice = merged.subarray(offset, offset + frameSize * channels);
        const frames = frameSize;
        const relativePts = Math.max(
          0,
          ptsUs - (basePtsUs ?? 0) + Math.round((offset / channels / sampleRate) * 1_000_000),
        );
        const audioData = new AudioData({
          format: 'f32',
          sampleRate,
          numberOfFrames: frames,
          numberOfChannels: channels,
          timestamp: relativePts,
          data: new Float32Array(slice),
        });
        audioEncoder.encode(audioData);
        audioData.close();
        offset += frameSize * channels;
      }
      pcmCarry = merged.subarray(offset);
    },

    async stop() {
      if (closed) {
        throw new Error('Live record: recorder already stopped');
      }
      closed = true;
      try {
        await videoEncoder.flush();
      } catch {
        /* ignore flush errors after abort */
      }
      try {
        await audioEncoder.flush();
      } catch {
        /* ignore */
      }
      try {
        videoEncoder.close();
      } catch {
        /* ignore */
      }
      try {
        audioEncoder.close();
      } catch {
        /* ignore */
      }

      if (!videoConfig || videoPackets.length === 0) {
        throw new Error('Live record: no video packets encoded (need a camera keyframe)');
      }
      if (!audioConfig || audioPackets.length === 0) {
        throw new Error('Live record: no audio packets encoded (need microphone audio)');
      }

      const result = muxEncodedTracksToMp4([
        {
          kind: 'video',
          codec: videoCodec,
          codecFamily: 'h264',
          codecConfig: videoConfig,
          width,
          height,
          packets: videoPackets,
        },
        {
          kind: 'audio',
          codec: audioCodec,
          codecFamily: 'aac',
          codecConfig: audioConfig,
          sampleRate,
          channels,
          packets: audioPackets,
        },
      ]);

      return {
        fileName,
        mimeType: 'video/mp4',
        extension: 'mp4',
        data: result.data,
        metadata: {
          durationUs: result.durationUs,
          videoSampleCount: result.videoSampleCount,
          audioSampleCount: result.audioSampleCount,
          source: 'live_av_recorder',
        },
      };
    },

    abort() {
      if (closed) return;
      closed = true;
      try {
        videoEncoder.close();
      } catch {
        /* ignore */
      }
      try {
        audioEncoder.close();
      } catch {
        /* ignore */
      }
    },
  };
}

function stripAdtsIfPresent(data: Uint8Array): Uint8Array {
  if (data.byteLength < 7) return data;
  if ((data[0]! & 0xff) !== 0xff || (data[1]! & 0xf0) !== 0xf0) return data;
  const protectionAbsent = (data[1]! & 0x01) !== 0;
  const headerLength = protectionAbsent ? 7 : 9;
  if (headerLength >= data.byteLength) return data;
  return data.subarray(headerLength);
}
