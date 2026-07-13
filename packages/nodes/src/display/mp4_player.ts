import type { MediaFile, MediaSource, NodeDefinition } from '@media-workflow/core';
import { isMp4OrFmp4Signature, parseMp4Metadata } from '@media-workflow/codec';

export const mp4PlayerNode: NodeDefinition<
  { source: 'playback_source' },
  { preview: 'string' }
> = {
  id: 'mp4_player',
  category: 'inspect',
  displayName: 'MP4 Player',
  description: 'Play MP4 bytes from MP4 Muxer or a loaded MP4 media source.',
  inputs: {
    source: { type: 'playback_source', label: 'MP4 File or Source' },
  },
  outputs: {
    preview: { type: 'string', label: 'Playback Metadata' },
  },
  params: {
    autoplay: { name: 'autoplay', type: 'boolean', default: false },
  },
  async execute(ctx, { inputs, params }) {
    const file = normalizeMp4Input(inputs.source as MediaFile | MediaSource | undefined);
    const metadata = parseMp4Metadata(file.data);
    if (!metadata) {
      throw new Error('Mp4Player: input is not a valid MP4 file');
    }

    ctx.log.info(
      `Mp4Player: ${file.fileName} · ${metadata.videoTrackCount} video · ${metadata.audioTrackCount} audio · ${metadata.durationMs.toFixed(0)} ms`,
    );
    return {
      preview: JSON.stringify({
        fileName: file.fileName,
        mimeType: file.mimeType,
        byteLength: file.data.byteLength,
        durationMs: metadata.durationMs,
        trackCount: metadata.trackCount,
        videoTrackCount: metadata.videoTrackCount,
        audioTrackCount: metadata.audioTrackCount,
        autoplay: Boolean(params.autoplay),
      }),
    };
  },
};

export function normalizeMp4Input(
  value: MediaFile | MediaSource | undefined,
): MediaFile {
  if (!value) throw new Error('Mp4Player: MP4 input is required');

  if ('fileName' in value && value.data instanceof Uint8Array) {
    assertMp4Bytes(value.data);
    return value;
  }

  if ('sourceId' in value && value.data instanceof Uint8Array) {
    assertMp4Bytes(value.data);
    const fileName = value.name.toLowerCase().endsWith('.mp4')
      ? value.name
      : `${value.name.replace(/\.[^.]+$/, '') || 'video'}.mp4`;
    return {
      fileName,
      mimeType: 'video/mp4',
      extension: 'mp4',
      data: value.data,
      metadata: {
        sourceId: value.sourceId,
        sourceVersion: value.version,
      },
    };
  }

  throw new Error('Mp4Player: input must be a media file or media source');
}

function assertMp4Bytes(data: Uint8Array): void {
  if (!isMp4OrFmp4Signature(data)) {
    throw new Error('Mp4Player: input does not contain an MP4 ftyp signature');
  }
}
