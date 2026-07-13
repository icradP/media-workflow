export {
  buildCaptureMediaSelection,
  createCaptureAsset,
} from './selection.js';
export type { CaptureSessionInfo, CaptureTrackRole } from './selection.js';
export {
  captureFromDevices,
  captureAudioTrack,
  captureVideoTrack,
  isBrowserCaptureAvailable,
  listMediaDevices,
  openCaptureStreams,
  stopCaptureStreams,
} from './browser.js';
export type {
  DeviceCaptureOptions,
  DeviceCaptureResult,
  MediaDeviceSummary,
  OpenCaptureStreamsResult,
} from './browser.js';
