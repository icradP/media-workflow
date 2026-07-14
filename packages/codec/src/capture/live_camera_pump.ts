import type { DecodedVideoFrame } from '@media-workflow/core';
import { copyVideoFrame } from '../decode/yuv.js';

export interface LiveCameraPump {
  /** Latest decoded camera frame (I420), if any. */
  pullLatest(): DecodedVideoFrame | undefined;
  stop(): void;
}

/**
 * Continuous camera → DecodedVideoFrame pump for Live Play.
 * Uses MediaStreamTrackProcessor when available; otherwise samples a <video> element.
 */
export function createLiveCameraPump(track: MediaStreamTrack): LiveCameraPump {
  let closed = false;
  let latest: DecodedVideoFrame | undefined;
  let frameIndex = 0;
  const trackId = track.id || 'capture:video:live';

  let reader: ReadableStreamDefaultReader<VideoFrame> | undefined;
  let pumpPromise: Promise<void> = Promise.resolve();
  let videoElement: HTMLVideoElement | undefined;
  let sampleTimer: ReturnType<typeof setInterval> | undefined;

  if ('MediaStreamTrackProcessor' in globalThis) {
    const Processor = (globalThis as typeof globalThis & {
      MediaStreamTrackProcessor: new (init: { track: MediaStreamTrack }) => {
        readable: ReadableStream<VideoFrame>;
      };
    }).MediaStreamTrackProcessor;
    const processor = new Processor({ track });
    reader = processor.readable.getReader();
    pumpPromise = (async () => {
      try {
        while (!closed && reader) {
          const result = await reader.read();
          if (result.done || !result.value) break;
          const frame = result.value;
          try {
            const decoded = await copyVideoFrame(
              frame,
              `${trackId}:${frameIndex++}`,
              'I420',
            );
            decoded.ptsUs = Math.round(frame.timestamp ?? performance.now() * 1_000);
            decoded.durationUs = Math.round(frame.duration ?? 33_333);
            latest = decoded;
          } finally {
            frame.close();
          }
        }
      } catch {
        /* stopped / aborted */
      }
    })();
  } else {
    const stream = new MediaStream([track]);
    videoElement = document.createElement('video');
    videoElement.muted = true;
    videoElement.playsInline = true;
    videoElement.srcObject = stream;
    void videoElement.play().catch(() => undefined);

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    sampleTimer = setInterval(() => {
      if (closed || !videoElement || !context) return;
      const width = videoElement.videoWidth || track.getSettings().width || 640;
      const height = videoElement.videoHeight || track.getSettings().height || 480;
      if (width <= 0 || height <= 0) return;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      context.drawImage(videoElement, 0, 0, width, height);
      void (async () => {
        try {
          const bitmap = await createImageBitmap(canvas);
          const videoFrame = new VideoFrame(bitmap, {
            timestamp: Math.round(performance.now() * 1_000),
            duration: 33_333,
          });
          bitmap.close();
          try {
            const decoded = await copyVideoFrame(
              videoFrame,
              `${trackId}:${frameIndex++}`,
              'I420',
            );
            decoded.ptsUs = Math.round(performance.now() * 1_000);
            decoded.durationUs = 33_333;
            latest = decoded;
          } finally {
            videoFrame.close();
          }
        } catch {
          /* ignore sample errors */
        }
      })();
    }, 33);
  }

  return {
    pullLatest() {
      return latest;
    },
    stop() {
      closed = true;
      if (sampleTimer) {
        clearInterval(sampleTimer);
        sampleTimer = undefined;
      }
      if (reader) {
        void reader.cancel().catch(() => undefined);
        reader.releaseLock();
        reader = undefined;
      }
      void pumpPromise;
      if (videoElement) {
        videoElement.pause();
        videoElement.srcObject = null;
        videoElement = undefined;
      }
      latest = undefined;
    },
  };
}
