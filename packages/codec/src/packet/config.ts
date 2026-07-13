import type {
  AudioMediaTrack,
  BitstreamFormat,
  CodecFamily,
  DecoderConfig,
  DetectedMediaFormat,
  MediaTrack,
  VideoMediaTrack,
} from '@media-workflow/core';

export function buildDecoderConfig(
  track: MediaTrack,
  containerFormat: DetectedMediaFormat,
): DecoderConfig | undefined {
  if (track.kind === 'video' && track.codecFamily === 'h264') {
    return buildH264DecoderConfig(track, containerFormat);
  }
  if (track.kind === 'audio' && track.codecFamily === 'aac') {
    return buildAacDecoderConfig(track, containerFormat);
  }
  if (track.kind === 'audio' && track.codecFamily === 'g711') {
    return buildG711DecoderConfig(track);
  }
  return undefined;
}

export function buildH264DecoderConfig(
  track: VideoMediaTrack,
  containerFormat: DetectedMediaFormat,
): DecoderConfig | undefined {
  const description = track.codecConfig ?? undefined;
  if (!description || description.byteLength < 5) return undefined;

  const profile = description[1]!;
  const compat = description[2]!;
  const level = description[3]!;
  const codec = `avc1.${hex(profile)}${hex(compat)}${hex(level)}`;
  const bitstreamFormat = resolveVideoBitstreamFormat(containerFormat);

  return {
    codec,
    codecFamily: 'h264',
    description,
    bitstreamFormat,
    codedWidth: track.width,
    codedHeight: track.height,
    metadata: {
      profile: track.profile,
      level: track.level,
      containerFormat,
    },
  };
}

export function buildAacDecoderConfig(
  track: AudioMediaTrack,
  containerFormat: DetectedMediaFormat,
): DecoderConfig | undefined {
  const description = track.codecConfig ?? undefined;
  if (!description || description.byteLength < 2) return undefined;

  const objectType = (description[0]! >> 3) & 0x1f;
  const freqIndex = ((description[0]! & 0x07) << 1) | ((description[1]! >> 7) & 0x01);
  const channels = (description[1]! >> 3) & 0x0f;
  const codec = `mp4a.40.${objectType}`;
  const bitstreamFormat = resolveAudioBitstreamFormat(containerFormat, 'aac');

  return {
    codec,
    codecFamily: 'aac',
    description,
    bitstreamFormat,
    sampleRate: track.sampleRate,
    channels: track.channels ?? channels,
    metadata: {
      profile: track.profile,
      samplingFrequencyIndex: freqIndex,
      containerFormat,
    },
  };
}

export function buildG711DecoderConfig(track: AudioMediaTrack): DecoderConfig | undefined {
  const law = String(track.metadata['g711.law'] ?? track.metadata.g711Law ?? 'ulaw');
  const bitstreamFormat: BitstreamFormat = law === 'alaw' ? 'g711_alaw' : 'g711_ulaw';

  return {
    codec: bitstreamFormat === 'g711_alaw' ? 'alaw' : 'ulaw',
    codecFamily: 'g711',
    bitstreamFormat,
    sampleRate: track.sampleRate ?? 8_000,
    channels: track.channels ?? 1,
    metadata: {
      law,
    },
  };
}

export function resolveVideoBitstreamFormat(containerFormat: DetectedMediaFormat): BitstreamFormat {
  if (containerFormat === 'mpegts' || containerFormat === 'mpegps') return 'annexb';
  if (containerFormat === 'flv' || containerFormat === 'mp4') return 'avcc';
  return 'unknown';
}

export function resolveAudioBitstreamFormat(
  containerFormat: DetectedMediaFormat,
  codecFamily: CodecFamily,
): BitstreamFormat {
  if (codecFamily === 'g711') {
    return 'g711_ulaw';
  }
  if (codecFamily === 'aac') {
    if (containerFormat === 'mpegts' || containerFormat === 'mpegps') return 'adts';
    return 'aac_raw';
  }
  if (codecFamily === 'mp3') {
    return 'mp3';
  }
  return 'unknown';
}

function hex(value: number): string {
  return value.toString(16).padStart(2, '0');
}
