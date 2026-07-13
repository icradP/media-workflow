import type {
  AudioMediaTrack,
  MediaAsset,
  MediaSample,
  MediaSelection,
  MediaTrack,
  VideoMediaTrack,
} from '@media-workflow/core';
import { annexBToAvcc } from '../decode/bitstream.js';
import { sampleToEncodedPacket } from '../packet/normalize.js';
import {
  buildFtyp,
  buildHdlr,
  buildMdhd,
  buildMdia,
  buildMinf,
  buildMoov,
  buildMdat,
  buildMvhd,
  buildStbl,
  buildStco,
  buildStsc,
  buildStsdAudio,
  buildStsdMp3Audio,
  buildStsdVideo,
  buildStss,
  buildStsz,
  buildStts,
  buildTkhd,
  buildTrak,
  microsecondsToTicks,
  movieTimeScale,
} from './boxes.js';

export interface RemuxMp4Options {
  videoTrackIndex?: number;
  audioTrackIndex?: number;
  includeVideo?: boolean;
  includeAudio?: boolean;
  startTimeUs?: number;
  endTimeUs?: number;
}

export interface RemuxMp4Result {
  data: Uint8Array;
  durationUs: number;
  videoSampleCount: number;
  audioSampleCount: number;
}

export interface RemuxMp4SelectionOptions {
  video?: MediaSelection;
  audio?: MediaSelection;
  /** How to align tracks when both are present. Default: trim_to_video. */
  align?: MuxAlignMode;
}

export type MuxAlignMode = 'none' | 'trim_to_video' | 'trim_to_audio';

export function remuxMediaSelectionsToMp4(
  options: RemuxMp4SelectionOptions,
): RemuxMp4Result {
  if (!options.video && !options.audio) {
    throw new Error('RemuxMp4: at least one video or audio selection is required');
  }

  const align = normalizeAlignMode(options.align);
  let videoSamples = options.video
    ? sortedSamples(options.video)
    : undefined;
  let audioSamples = options.audio
    ? sortedSamples(options.audio)
    : undefined;

  validateSelectionSamples(options.video, videoSamples, 'video');
  validateSelectionSamples(options.audio, audioSamples, 'audio');

  if (videoSamples && audioSamples && align !== 'none') {
    const videoSpanUs = selectionSpanUs(videoSamples);
    const audioSpanUs = selectionSpanUs(audioSamples);
    if (align === 'trim_to_video') {
      audioSamples = trimSamplesBySpan(audioSamples, videoSpanUs);
    } else if (align === 'trim_to_audio') {
      videoSamples = trimSamplesBySpan(videoSamples, audioSpanUs);
    }
    if (videoSamples.length === 0 || audioSamples.length === 0) {
      throw new Error('RemuxMp4: alignment trimmed all samples from one track');
    }
  }

  const muxTracks: MuxTrack[] = [];
  if (options.video && videoSamples) {
    muxTracks.push(buildMuxTrackFromSamples(options.video, 'video', videoSamples));
  }
  if (options.audio && audioSamples) {
    muxTracks.push(buildMuxTrackFromSamples(options.audio, 'audio', audioSamples));
  }

  return finalizeMp4(muxTracks);
}

export function remuxMediaAssetToMp4(
  asset: MediaAsset,
  options: RemuxMp4Options = {},
): RemuxMp4Result {
  if (asset.container.format !== 'mp4' &&
    asset.container.format !== 'flv' &&
    asset.container.format !== 'mpegts' &&
    asset.container.format !== 'mpegps') {
    throw new Error(`RemuxMp4: unsupported source container "${asset.container.format}"`);
  }

  const includeVideo = options.includeVideo !== false;
  const includeAudio = options.includeAudio !== false;
  const videoTrack = includeVideo
    ? pickTrack(asset, 'video', options.videoTrackIndex ?? 0)
    : undefined;
  const audioTrack = includeAudio
    ? pickTrack(asset, 'audio', options.audioTrackIndex ?? 0)
    : undefined;

  if (!videoTrack && !audioTrack) {
    throw new Error('RemuxMp4: at least one video or audio track is required');
  }

  const startTimeUs = Math.max(0, options.startTimeUs ?? 0);
  const endTimeUs = options.endTimeUs;
  const muxTracks: MuxTrack[] = [];

  if (videoTrack) {
    muxTracks.push(buildMuxTrack(
      videoTrack,
      filterSamples(asset, videoTrack, startTimeUs, endTimeUs),
      asset.container.format,
    ));
  }
  if (audioTrack) {
    muxTracks.push(buildMuxTrack(
      audioTrack,
      filterSamples(asset, audioTrack, startTimeUs, endTimeUs),
      asset.container.format,
    ));
  }

  return finalizeMp4(muxTracks);
}

function buildMuxTrackFromSamples(
  selection: MediaSelection,
  expectedKind: 'video' | 'audio',
  samples: MediaSample[],
): MuxTrack {
  const { track, asset } = selection.selectedTrack;
  if (track.kind !== expectedKind) {
    throw new Error(
      `RemuxMp4: expected ${expectedKind} selection, got ${track.kind} (${track.trackId})`,
    );
  }
  if (samples.length === 0) {
    throw new Error(`RemuxMp4: ${expectedKind} selection ${selection.selectionId} is empty`);
  }
  if (!track.codecConfig || track.codecConfig.byteLength === 0) {
    const muxableMp3 = expectedKind === 'audio' &&
      isMuxableAudioWithoutCodecConfig(track as AudioMediaTrack);
    if (!muxableMp3) {
      throw new Error(`RemuxMp4: ${expectedKind} track ${track.trackId} is missing codec configuration`);
    }
  }

  return buildMuxTrack(
    track as VideoMediaTrack | AudioMediaTrack,
    samples,
    asset.container.format,
  );
}

function validateSelectionSamples(
  selection: MediaSelection | undefined,
  samples: MediaSample[] | undefined,
  kind: 'video' | 'audio',
): void {
  if (!selection) return;
  if (!samples || samples.length === 0) {
    throw new Error(`RemuxMp4: ${kind} selection ${selection.selectionId} is empty`);
  }
  const { track } = selection.selectedTrack;
  if (track.kind !== kind) {
    throw new Error(
      `RemuxMp4: expected ${kind} selection, got ${track.kind} (${track.trackId})`,
    );
  }
  if (!track.codecConfig || track.codecConfig.byteLength === 0) {
    const muxableMp3 = kind === 'audio' &&
      isMuxableAudioWithoutCodecConfig(track as AudioMediaTrack);
    if (!muxableMp3) {
      throw new Error(`RemuxMp4: ${kind} track ${track.trackId} is missing codec configuration`);
    }
  }
}

function isMuxableAudioWithoutCodecConfig(track: AudioMediaTrack): boolean {
  return track.codecFamily === 'mp3' &&
    Number(track.sampleRate) > 0 &&
    Number(track.channels) > 0;
}

function sortedSamples(selection: MediaSelection): MediaSample[] {
  return [...selection.samples].sort(
    (left, right) => left.ptsUs - right.ptsUs || left.index - right.index,
  );
}

function selectionSpanUs(samples: MediaSample[]): number {
  if (samples.length === 0) return 0;
  const origin = samples[0]!.ptsUs;
  const last = samples[samples.length - 1]!;
  return Math.max(1, (last.ptsUs - origin) + Math.max(1, last.durationUs ?? 1));
}

function trimSamplesBySpan(samples: MediaSample[], maxSpanUs: number): MediaSample[] {
  if (samples.length === 0) return samples;
  const origin = samples[0]!.ptsUs;
  return samples.filter(sample => (sample.ptsUs - origin) < maxSpanUs);
}

function normalizeAlignMode(value: unknown): MuxAlignMode {
  const mode = String(value ?? 'trim_to_video');
  return mode === 'none' || mode === 'trim_to_audio' ? mode : 'trim_to_video';
}

function finalizeMp4(muxTracks: MuxTrack[]): RemuxMp4Result {
  for (const track of muxTracks) {
    if (track.samples.length === 0) {
      throw new Error(`RemuxMp4: track ${track.track.trackId} has no samples`);
    }
  if (!track.track.codecConfig || track.track.codecConfig.byteLength === 0) {
    if (!(track.track.kind === 'audio' && isMuxableAudioWithoutCodecConfig(track.track as AudioMediaTrack))) {
      throw new Error(`RemuxMp4: track ${track.track.trackId} is missing codec configuration`);
    }
  }
  }

  const ftyp = buildFtyp();
  const mdatPayload = concatTrackPayloads(muxTracks);
  const mdat = buildMdat(mdatPayload);

  const trackTimeScales = muxTracks.map(track => track.timeScale);
  const movieScale = movieTimeScale(trackTimeScales);
  const movieDurationTicks = Math.max(
    ...muxTracks.map(track => track.durationTicks),
    1,
  );

  const placeholderMoov = buildMoovForTracks(
    muxTracks,
    movieDurationTicks,
    movieScale,
    ftyp.byteLength + 8,
  );
  const mdatOffset = ftyp.byteLength + placeholderMoov.byteLength + 8;
  const moov = buildMoovForTracks(
    muxTracks,
    movieDurationTicks,
    movieScale,
    mdatOffset,
  );

  const data = concatBytes(ftyp, moov, mdat);
  const durationUs = Math.max(
    ...muxTracks.map(track => track.durationUs),
    1,
  );

  return {
    data,
    durationUs,
    videoSampleCount: muxTracks.find(track => track.track.kind === 'video')?.samples.length ?? 0,
    audioSampleCount: muxTracks.find(track => track.track.kind === 'audio')?.samples.length ?? 0,
  };
}

interface MuxTrack {
  track: VideoMediaTrack | AudioMediaTrack;
  samples: MediaSample[];
  payloads: Uint8Array[];
  timeScale: number;
  durationTicks: number;
  durationUs: number;
  deltas: number[];
}

function pickTrack(
  asset: MediaAsset,
  kind: 'video' | 'audio',
  index: number,
): VideoMediaTrack | AudioMediaTrack | undefined {
  const candidates = asset.tracks.filter(track => track.kind === kind);
  const track = candidates[index];
  if (!track || track.kind !== kind) return undefined;
  return track as VideoMediaTrack | AudioMediaTrack;
}

function filterSamples(
  asset: MediaAsset,
  track: MediaTrack,
  startTimeUs: number,
  endTimeUs: number | undefined,
): MediaSample[] {
  return asset.samples
    .filter(sample => sample.trackId === track.trackId)
    .filter(sample => {
      const sampleEndUs = sample.durationUs && sample.durationUs > 0
        ? sample.ptsUs + sample.durationUs
        : sample.ptsUs + 1;
      return sampleEndUs > startTimeUs &&
        (endTimeUs === undefined || sample.ptsUs < endTimeUs);
    })
    .sort((left, right) => left.ptsUs - right.ptsUs || left.index - right.index);
}

function buildMuxTrack(
  track: VideoMediaTrack | AudioMediaTrack,
  samples: MediaSample[],
  containerFormat: MediaAsset['container']['format'],
): MuxTrack {
  const timeScale = track.kind === 'audio'
    ? Math.max(1, track.sampleRate || 48_000)
    : 90_000;
  const payloads = samples.map(sample => {
    const packet = sampleToEncodedPacket(sample, track, containerFormat);
    if (!packet?.data || packet.data.byteLength === 0) {
      throw new Error(`RemuxMp4: sample ${sample.sampleId} has no payload bytes`);
    }
    if (track.kind === 'video') {
      return packet.bitstreamFormat === 'avcc'
        ? packet.data
        : annexBToAvcc(packet.data);
    }
    return packet.data;
  });

  const dtsTicks = samples.map(sample =>
    Math.max(0, Math.round(microsecondsToTicks(sample.dtsUs, timeScale))),
  );
  const baseDts = dtsTicks[0] ?? 0;
  const normalizedDts = dtsTicks.map(tick => Math.max(0, tick - baseDts));
  const deltas = normalizedDts.map((tick, index) => {
    if (index === 0) return Math.max(1, tick || 1);
    return Math.max(1, tick - normalizedDts[index - 1]!);
  });

  const durationTicks = Math.max(1, deltas.reduce((sum, delta) => sum + delta, 0));
  const last = samples[samples.length - 1];
  const durationUs = last
    ? Math.max(1, (last.ptsUs - samples[0]!.ptsUs) + (last.durationUs ?? 0))
    : 1;

  return {
    track,
    samples,
    payloads,
    timeScale,
    durationTicks,
    durationUs,
    deltas,
  };
}

function concatTrackPayloads(tracks: MuxTrack[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (const track of tracks) chunks.push(...track.payloads);
  return concatBytes(...chunks);
}

function buildMoovForTracks(
  tracks: MuxTrack[],
  movieDurationTicks: number,
  movieScale: number,
  firstChunkOffset: number,
): Uint8Array {
  let payloadOffset = firstChunkOffset;
  const trakBoxes = tracks.map((track, index) => {
    const sizes = track.payloads.map(payload => payload.byteLength);
    const chunkOffset = payloadOffset;
    payloadOffset += sizes.reduce((sum, size) => sum + size, 0);
    return buildTrackBox(track, index + 1, chunkOffset, sizes);
  });
  return buildMoov(
    buildMvhd(movieDurationTicks, movieScale, tracks.length + 1),
    ...trakBoxes,
  );
}

function buildTrackBox(
  track: MuxTrack,
  trackId: number,
  chunkOffset: number,
  sizes: number[],
): Uint8Array {
  const isAudio = track.track.kind === 'audio';
  const stsd = isAudio
    ? buildAudioStsd(track.track as AudioMediaTrack)
    : buildStsdVideo(
      Math.max(1, (track.track as VideoMediaTrack).width ?? 0),
      Math.max(1, (track.track as VideoMediaTrack).height ?? 0),
      track.track.codecConfig!,
      track.track.decoderConfig?.codec ?? 'avc1.42c01e',
    );

  const stblChildren = [
    stsd,
    buildStts(track.deltas),
    buildStsc(sizes.length),
    buildStsz(sizes),
    buildStco([chunkOffset]),
  ];
  if (!isAudio) {
    const keySamples = track.samples
      .map((sample, index) => sample.isKey ? index + 1 : 0)
      .filter(index => index > 0);
    if (keySamples.length > 0) stblChildren.push(buildStss(keySamples));
  }

  const mdia = buildMdia(
    buildMdhd(track.durationTicks, track.timeScale),
    buildHdlr(isAudio ? 'soun' : 'vide'),
    buildMinf(isAudio, buildStbl(...stblChildren)),
  );

  return buildTrak(
    buildTkhd(
      trackId,
      track.durationTicks,
      track.timeScale,
      isAudio ? 0 : ((track.track as VideoMediaTrack).width ?? 0),
      isAudio ? 0 : ((track.track as VideoMediaTrack).height ?? 0),
      isAudio,
    ),
    mdia,
  );
}

function buildAudioStsd(track: AudioMediaTrack): Uint8Array {
  const channels = Math.max(1, track.channels ?? 2);
  const sampleRate = Math.max(1, track.sampleRate ?? 48_000);
  if (track.codecFamily === 'mp3') {
    return buildStsdMp3Audio(channels, sampleRate);
  }
  if (!track.codecConfig || track.codecConfig.byteLength === 0) {
    throw new Error(`RemuxMp4: audio track ${track.trackId} is missing codec configuration`);
  }
  return buildStsdAudio(channels, sampleRate, track.codecConfig);
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, array) => sum + array.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const array of arrays) {
    result.set(array, offset);
    offset += array.byteLength;
  }
  return result;
}
