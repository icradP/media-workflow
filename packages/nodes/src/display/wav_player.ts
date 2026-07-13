import type { MediaFile, MediaSource, NodeDefinition } from '@media-workflow/core';
import { isWavSignature, parseWavMetadata } from '@media-workflow/codec';

export const wavPlayerNode: NodeDefinition<
  { source: 'playback_source' },
  { preview: 'string' }
> = {
  id: 'wav_player',
  category: 'inspect',
  displayName: 'WAV Player',
  description: 'Play WAV bytes from WAV Encoder or a loaded WAV file source.',
  inputs: {
    source: { type: 'playback_source', label: 'WAV File or Source' },
  },
  outputs: {
    preview: { type: 'string', label: 'Playback Metadata' },
  },
  params: {
    autoplay: { name: 'autoplay', type: 'boolean', default: false },
  },
  async execute(ctx, { inputs, params }) {
    const file = normalizeWavInput(inputs.source as MediaFile | MediaSource | undefined);
    const metadata = parseWavMetadata(file.data);
    if (!metadata) {
      throw new Error('WavPlayer: input is not a valid WAV file');
    }

    ctx.log.info(
      `WavPlayer: ${file.fileName} · ${metadata.sampleRate} Hz · ${metadata.channels} ch · ${metadata.durationMs.toFixed(0)} ms`,
    );
    return {
      preview: JSON.stringify({
        fileName: file.fileName,
        mimeType: file.mimeType,
        byteLength: file.data.byteLength,
        sampleRate: metadata.sampleRate,
        channels: metadata.channels,
        bitsPerSample: metadata.bitsPerSample,
        durationMs: metadata.durationMs,
        autoplay: Boolean(params.autoplay),
      }),
    };
  },
};

export function normalizeWavInput(
  value: MediaFile | MediaSource | undefined,
): MediaFile {
  if (!value) throw new Error('WavPlayer: WAV input is required');

  if ('fileName' in value && value.data instanceof Uint8Array) {
    assertWavBytes(value.data);
    return value;
  }

  if ('sourceId' in value && value.data instanceof Uint8Array) {
    assertWavBytes(value.data);
    const fileName = value.name.toLowerCase().endsWith('.wav')
      ? value.name
      : `${value.name.replace(/\.[^.]+$/, '') || 'audio'}.wav`;
    return {
      fileName,
      mimeType: 'audio/wav',
      extension: 'wav',
      data: value.data,
      metadata: {
        sourceId: value.sourceId,
        sourceVersion: value.version,
      },
    };
  }

  throw new Error('WavPlayer: input must be a media file or media source');
}

function assertWavBytes(data: Uint8Array): void {
  if (!isWavSignature(data)) {
    throw new Error('WavPlayer: input does not contain a WAV RIFF header');
  }
}
