import type { AudioMediaTrack, VideoMediaTrack } from '@media-workflow/core';

export const MP4_MUX_DIRECT_VIDEO = 'H.264 (AVC) with avcC / AudioSpecificConfig in track metadata or keyframe samples';

export const MP4_MUX_DIRECT_AUDIO = [
  'AAC (requires AudioSpecificConfig)',
  'MP3 (requires sample rate and channel count)',
] as const;

export const MP4_MUX_TRANSCODE_WORKFLOW =
  'Audio Decode → AAC Encoder → MP4 Muxer';

export const MP4_MUX_UNSUPPORTED_AUDIO_HINT: Record<string, string> = {
  g711: 'G.711 (A-law / μ-law) cannot be muxed into MP4 directly',
  mp3: 'MP3 may need transcode for reliable MP4 playback',
};

export function describeMuxSupportedFormats(): string {
  return [
    `Direct remux video: ${MP4_MUX_DIRECT_VIDEO}`,
    `Direct remux audio: ${MP4_MUX_DIRECT_AUDIO.join(', ')}`,
    `Transcode path: ${MP4_MUX_TRANSCODE_WORKFLOW}`,
  ].join('; ');
}

export function formatMuxVideoError(track: VideoMediaTrack): string {
  return [
    `RemuxMp4: video track ${track.trackId} (${track.codecFamily}/${track.codec}) is missing codec configuration.`,
    `Supported: ${MP4_MUX_DIRECT_VIDEO}.`,
  ].join(' ');
}

export function formatMuxAudioError(track: AudioMediaTrack): string {
  const codecLabel = `${track.codecFamily}/${track.codec}`;
  const unsupported = MP4_MUX_UNSUPPORTED_AUDIO_HINT[track.codecFamily];

  if (unsupported) {
    return [
      `RemuxMp4: audio track ${track.trackId} (${codecLabel}) cannot be muxed into MP4 directly.`,
      unsupported + '.',
      `Use transcode path: ${MP4_MUX_TRANSCODE_WORKFLOW}.`,
      `Direct remux supports: ${MP4_MUX_DIRECT_AUDIO.join(', ')}.`,
    ].join(' ');
  }

  return [
    `RemuxMp4: audio track ${track.trackId} (${codecLabel}) is missing AAC codec configuration.`,
    `Use transcode path: ${MP4_MUX_TRANSCODE_WORKFLOW}, or ensure the source includes an AAC sequence header.`,
    `Direct remux supports: ${MP4_MUX_DIRECT_AUDIO.join(', ')}.`,
  ].join(' ');
}
