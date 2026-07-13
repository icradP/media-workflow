import type {
  AudioMediaTrack,
  MediaAsset,
  MediaDiagnostic,
  MediaSample,
  MediaSelection,
  MediaSelectionCriteria,
  VideoMediaTrack,
} from '@media-workflow/core';
import { stableSelectionId } from '../planner/selection.js';

export type CaptureTrackRole = 'video' | 'microphone' | 'speaker';

export interface CaptureSessionInfo {
  sessionId: string;
  version: string;
  durationUs: number;
  label: string;
}

export function createCaptureAsset(
  session: CaptureSessionInfo,
  tracks: Array<VideoMediaTrack | AudioMediaTrack>,
  samples: MediaSample[],
): MediaAsset {
  const diagnostics: MediaDiagnostic[] = [];
  return {
    source: {
      sourceId: session.sessionId,
      version: session.version,
      kind: 'stream',
      name: session.label,
      size: 0,
      data: new Uint8Array(0),
      metadata: {
        capture: true,
        durationUs: session.durationUs,
      },
    },
    probe: {
      sourceId: session.sessionId,
      format: 'mp4',
      confidence: 1,
      candidates: [{
        format: 'mp4',
        confidence: 1,
        reason: 'Live capture session',
      }],
      diagnostics: [],
    },
    container: {
      format: 'mp4',
      longName: 'Live Capture',
      durationUs: session.durationUs,
      metadata: { capture: true },
    },
    tracks,
    samples,
    metadata: { capture: true },
    diagnostics,
    analyzedAt: new Date().toISOString(),
    analysisDurationMs: 0,
  };
}

export function buildCaptureMediaSelection(options: {
  session: CaptureSessionInfo;
  role: CaptureTrackRole;
  track: VideoMediaTrack | AudioMediaTrack;
  criteria?: Partial<MediaSelectionCriteria>;
}): MediaSelection {
  const { session, role, track } = options;
  const criteria: MediaSelectionCriteria = {
    startIndex: 0,
    endIndex: undefined,
    startTimeUs: 0,
    endTimeUs: session.durationUs,
    frameType: 'all',
    limit: undefined,
    order: 'presentation',
    ...options.criteria,
  };

  const asset = createCaptureAsset(session, [track], []);
  const selectedTrack = {
    selectedTrackId: `${session.sessionId}:${session.version}:${track.trackId}`,
    asset,
    track,
    samples: [] as MediaSample[],
    diagnostics: [] as MediaDiagnostic[],
  };

  const selectionId = stableSelectionId({
    sourceId: session.sessionId,
    sourceVersion: session.version,
    role,
    trackId: track.trackId,
    durationUs: session.durationUs,
  });

  return {
    selectionId,
    selectedTrack,
    samples: [],
    rangeStartUs: 0,
    rangeEndUs: session.durationUs,
    criteria,
    diagnostics: [],
  };
}
