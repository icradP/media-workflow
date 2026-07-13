import type { MediaFile, NodeDefinition, PcmAudioClip } from '@media-workflow/core';
import { encodeWav, type WavSampleFormat } from '@media-workflow/codec';

export const wavEncoderNode: NodeDefinition<
  { pcm: 'pcm_audio' },
  { file: 'media_file' }
> = {
  id: 'wav_encoder',
  category: 'transform',
  displayName: 'WAV Encoder',
  description: 'Encode planar Float32 PCM into a WAV media file.',
  inputs: {
    pcm: { type: 'pcm_audio', label: 'PCM Audio Clip' },
  },
  outputs: {
    file: { type: 'media_file', label: 'WAV File' },
  },
  params: {
    fileName: { name: 'fileName', type: 'string', default: 'audio.wav' },
    sampleFormat: {
      name: 'sampleFormat',
      type: 'enum',
      default: 'pcm16',
      values: ['pcm16', 'float32'],
    },
  },
  async execute(ctx, { inputs, params }) {
    const pcm = inputs.pcm as PcmAudioClip | undefined;
    if (!pcm) throw new Error('WavEncoder: PCM clip is required');

    const format = String(params.sampleFormat ?? 'pcm16') as WavSampleFormat;
    const data = encodeWav(pcm, format);
    const fileName = String(params.fileName || 'audio.wav');
    ctx.log.info(`WavEncoder: ${data.byteLength} bytes (${format})`);
    return {
      file: {
        fileName,
        mimeType: 'audio/wav',
        extension: 'wav',
        data,
        metadata: {
          sampleRate: pcm.sampleRate,
          channels: pcm.channels,
          sampleCount: pcm.sampleCount,
          durationUs: pcm.durationUs,
          sampleFormat: format,
        },
      },
    };
  },
};
