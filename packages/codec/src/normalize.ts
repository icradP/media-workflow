import type {
  AudioMediaTrack,
  CodecFamily,
  DetectedMediaFormat,
  FrameInfo,
  MediaAnalysisResult,
  MediaAsset,
  MediaDiagnostic,
  MediaProbe,
  MediaSample,
  MediaSource,
  MediaTrack,
  StreamInfo,
  VideoMediaTrack,
} from '@media-workflow/core';
import { buildDecoderConfig } from './packet/config.js';
import { enrichAssetCodecConfig } from './codec_config/infer.js';
import { detectContainerFormat } from './detect.js';

const FORMAT_NAMES: Record<DetectedMediaFormat, string> = {
  flv: 'Flash Video',
  mpegts: 'MPEG Transport Stream',
  mpegps: 'MPEG Program Stream',
  mp4: 'ISO Base Media File',
  wav: 'Waveform Audio',
  flac: 'Free Lossless Audio Codec',
  mp3: 'MPEG Audio Layer III',
  opus: 'Ogg Opus',
  unknown: 'Unknown media',
};

export function probeMediaSource(source: MediaSource): MediaProbe {
  const format = detectContainerFormat(source.data);
  const confidence = format === 'unknown' ? 0 : format === 'mp3' ? 0.7 : 0.98;
  const diagnostics: MediaDiagnostic[] = [];

  if (format === 'unknown') {
    diagnostics.push({
      severity: 'warning',
      code: 'probe.unknown_format',
      message: 'The media container could not be identified from its signature.',
    });
  }

  return {
    sourceId: source.sourceId,
    format,
    confidence,
    candidates: [{
      format,
      confidence,
      reason: format === 'unknown' ? 'No known signature matched' : 'Container signature matched',
    }],
    diagnostics,
  };
}

export function normalizeAnalysis(
  source: MediaSource,
  probe: MediaProbe,
  legacy: MediaAnalysisResult,
  analysisDurationMs: number,
): MediaAsset {
  const diagnostics = [...probe.diagnostics];
  const tracks = legacy.streams.map((stream, index) =>
    normalizeTrack(stream, index, probe.format),
  );
  const samples = normalizeSamples(legacy.frames, tracks, diagnostics, source);
  const samplesByTrack = countSamplesByTrack(samples);
  const legacyDurationUs = durationFromLegacyContainer(legacy);

  for (const track of tracks) {
    track.sampleCount = samplesByTrack.get(track.trackId) ?? track.sampleCount;
    const trackSamples = samples.filter(sample => sample.trackId === track.trackId);
    const durationUs = durationFromSamples(trackSamples) ?? legacyDurationUs;
    if (track.durationUs === undefined && durationUs !== undefined) track.durationUs = durationUs;
    if (durationUs && durationUs > 0 && trackSamples.length > 0) {
      const bytes = trackSamples.reduce((total, sample) => total + sample.size, 0);
      track.bitrate = Math.round((bytes * 8 * 1_000_000) / durationUs);
    }
  }

  if (tracks.length === 0 && probe.format !== 'unknown') {
    diagnostics.push({
      severity: 'warning',
      code: 'analysis.no_tracks',
      message: `The ${probe.format} container was detected but no media tracks were parsed.`,
    });
  }

  const durationUs = maxDefined(tracks.map(track => track.durationUs)) ?? legacyDurationUs;
  const asset: MediaAsset = {
    source,
    probe,
    container: {
      format: probe.format,
      longName: FORMAT_NAMES[probe.format],
      durationUs,
      bitrate: durationUs && durationUs > 0
        ? Math.round((source.size * 8 * 1_000_000) / durationUs)
        : undefined,
      metadata: {
        subtype: legacy.format.subtype,
        ...legacy.format.details,
      },
    },
    tracks,
    samples,
    metadata: legacy.formatSpecific,
    diagnostics,
    analyzedAt: new Date().toISOString(),
    analysisDurationMs,
  };

  enrichAssetCodecConfig(asset);
  for (const track of asset.tracks) {
    if (track.kind === 'video' || track.kind === 'audio') {
      track.decoderConfig = buildDecoderConfig(track, probe.format);
    }
  }

  asset.diagnostics.push(...validateMediaAsset(asset));
  return asset;
}

export function validateMediaAsset(asset: MediaAsset): MediaDiagnostic[] {
  const diagnostics: MediaDiagnostic[] = [];
  const trackIds = new Set<string>();

  for (const track of asset.tracks) {
    if (trackIds.has(track.trackId)) {
      diagnostics.push({
        severity: 'error',
        code: 'asset.duplicate_track_id',
        message: `Duplicate track ID: ${track.trackId}`,
        path: `tracks.${track.index}`,
      });
    }
    trackIds.add(track.trackId);
  }

  for (const sample of asset.samples) {
    if (!trackIds.has(sample.trackId)) {
      diagnostics.push({
        severity: 'error',
        code: 'asset.invalid_sample_track',
        message: `Sample ${sample.sampleId} references missing track ${sample.trackId}.`,
        path: `samples.${sample.index}.trackId`,
      });
    }
    if (![sample.ptsUs, sample.dtsUs, sample.offset, sample.size].every(Number.isFinite)) {
      diagnostics.push({
        severity: 'error',
        code: 'asset.invalid_sample_number',
        message: `Sample ${sample.sampleId} contains a non-finite numeric value.`,
        path: `samples.${sample.index}`,
      });
    }
  }

  for (const track of asset.tracks) {
    const samples = asset.samples
      .filter(sample => sample.trackId === track.trackId)
      .sort((left, right) => left.index - right.index);
    let previousDts: number | undefined;
    let violations = 0;
    for (const sample of samples) {
      if (previousDts !== undefined && sample.dtsUs <= previousDts) violations++;
      previousDts = sample.dtsUs;
    }
    if (violations > 0) {
      diagnostics.push({
        severity: 'warning',
        code: 'asset.non_monotonic_dts',
        message: `${track.trackId} contains ${violations} non-monotonic DTS transition(s).`,
        path: `tracks.${track.index}`,
        metadata: { trackId: track.trackId, violations },
      });
    }
  }

  return diagnostics;
}

function normalizeTrack(
  stream: StreamInfo,
  index: number,
  format: DetectedMediaFormat,
): MediaTrack {
  const sourceTrackId = stream.sourceId ?? stream.index;
  const trackId = `${format}:${stream.kind}:${sourceTrackId}`;
  const common = {
    trackId,
    index,
    codec: stream.codec || 'Unknown',
    codecFamily: normalizeCodecFamily(stream),
    codecConfig: stream.codecConfig,
    timeBase: stream.timeBase ?? { numerator: 1, denominator: 1_000_000 },
    durationUs: stream.durationMs === undefined
      ? undefined
      : millisecondsToMicroseconds(stream.durationMs),
    bitrate: stream.bitrate,
    sampleCount: stream.sampleCount ?? 0,
    language: stream.language,
    metadata: {
      legacyIndex: stream.index,
      sourceId: stream.sourceId,
      ...stream.metadata,
    },
  };

  if (stream.kind === 'video') {
    const track: VideoMediaTrack = {
      ...common,
      kind: 'video',
      width: positive(stream.video?.width),
      height: positive(stream.video?.height),
      profile: stream.video?.profile,
      level: stream.video?.level,
      bitDepth: positive(stream.video?.bitDepth),
      chromaFormat: stream.video?.chromaFormat !== undefined
        ? String(stream.video.chromaFormat)
        : undefined,
      frameRate: positive(stream.video?.framerate),
    };
    track.decoderConfig = buildDecoderConfig(track, format);
    return track;
  }

  if (stream.kind === 'audio') {
    const track: AudioMediaTrack = {
      ...common,
      kind: 'audio',
      sampleRate: positive(stream.audio?.sampleRate),
      channels: positive(stream.audio?.channels),
      profile: stream.audio?.profile,
      samplesPerFrame: positive(stream.audio?.samplesPerFrame),
    };
    track.decoderConfig = buildDecoderConfig(track, format);
    return track;
  }

  return { ...common, kind: 'data' };
}

function normalizeSamples(
  frames: FrameInfo[],
  tracks: MediaTrack[],
  diagnostics: MediaDiagnostic[],
  source: MediaSource,
): MediaSample[] {
  return frames.flatMap((frame, index) => {
    const directTrack = tracks.find(track =>
      Number(track.metadata.legacyIndex) === frame.streamIndex,
    );
    const track = directTrack ?? tracks.find(candidate => candidate.kind === frame.kind);
    if (!track) {
      diagnostics.push({
        severity: 'warning',
        code: 'analysis.unmapped_sample',
        message: `Frame ${frame.index} could not be mapped to a parsed track.`,
        path: `frames.${index}`,
      });
      return [];
    }

    return [{
      sampleId: `${track.trackId}:${frame.index}`,
      index,
      trackId: track.trackId,
      ptsUs: millisecondsToMicroseconds(frame.pts),
      dtsUs: millisecondsToMicroseconds(frame.dts),
      durationUs: frame.duration === undefined
        ? undefined
        : millisecondsToMicroseconds(frame.duration),
      offset: finiteNonNegative(frame.offset),
      size: finiteNonNegative(frame.size),
      isKey: frame.isKey,
      pictureType: frame.pictureType,
      data: frame.rawData ?? sliceSourceBytes(source, frame.offset, frame.size),
      metadata: {
        legacyFrameIndex: frame.index,
        isIdr: frame.isIdr,
        frameNum: frame.frameNum,
        dataOrigin: frame.dataOrigin ??
          (frame.rawData ? 'demuxed_payload' : 'source_slice'),
        ...frame.metadata,
      },
    }];
  });
}

function sliceSourceBytes(
  source: MediaSource,
  offset: number,
  size: number,
): Uint8Array | undefined {
  if (
    !Number.isFinite(offset) ||
    !Number.isFinite(size) ||
    offset < 0 ||
    size <= 0 ||
    offset + size > source.data.byteLength
  ) {
    return undefined;
  }
  return source.data.subarray(offset, offset + size);
}

function normalizeCodecFamily(stream: StreamInfo): CodecFamily {
  if (stream.codecFamily !== 'unknown') return stream.codecFamily;
  if (/pcm|float/i.test(stream.codec)) return 'pcm';
  if (/mp3|mpeg audio layer iii/i.test(stream.codec)) return 'mp3';
  return 'unknown';
}

function millisecondsToMicroseconds(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value * 1_000)) : 0;
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function positive(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined;
}

function countSamplesByTrack(samples: MediaSample[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const sample of samples) {
    counts.set(sample.trackId, (counts.get(sample.trackId) ?? 0) + 1);
  }
  return counts;
}

function durationFromSamples(samples: MediaSample[]): number | undefined {
  if (samples.length === 0) return undefined;
  const first = Math.min(...samples.map(sample => sample.dtsUs));
  const last = Math.max(...samples.map(sample => sample.ptsUs + (sample.durationUs ?? 0)));
  return last >= first ? last - first : undefined;
}

function maxDefined(values: Array<number | undefined>): number | undefined {
  const defined = values.filter((value): value is number => value !== undefined);
  return defined.length > 0 ? Math.max(...defined) : undefined;
}

function durationFromLegacyContainer(legacy: MediaAnalysisResult): number | undefined {
  const duration = Number(legacy.format.details.duration);
  const timeScale = Number(legacy.format.details.timeScale);
  if (Number.isFinite(duration) && duration >= 0 && Number.isFinite(timeScale) && timeScale > 0) {
    return Math.round((duration / timeScale) * 1_000_000);
  }
  const maxTimestamp = Number(legacy.formatSpecific.maxTimestamp);
  if (Number.isFinite(maxTimestamp) && maxTimestamp >= 0) {
    return Math.round(maxTimestamp * 1_000);
  }
  return undefined;
}
