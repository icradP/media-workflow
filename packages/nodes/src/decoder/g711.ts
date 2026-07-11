import type {
  AudioDecodeRequest,
  NodeDefinition,
  PcmAudioClip,
} from '@media-workflow/core';
import {
  DECODE_LIMITS,
  G711_SOFTWARE_BACKEND,
} from '@media-workflow/core/decoder';
import { decodeG711, int16ToFloat32Planar, trimPcmToRange } from '@media-workflow/codec';

export const g711DecoderNode: NodeDefinition<
  { request: 'audio_decode_request' },
  { pcm: 'pcm_audio' }
> = {
  id: 'g711_decoder',
  category: 'decoder',
  displayName: 'G.711 Decoder',
  description: 'Decode G.711 A-law or μ-law packets into planar Float32 PCM.',
  inputs: {
    request: { type: 'audio_decode_request', label: 'Audio Decode Request' },
  },
  outputs: {
    pcm: { type: 'pcm_audio', label: 'PCM Audio Clip' },
  },
  async execute(ctx, { inputs }) {
    const request = inputs.request as AudioDecodeRequest | undefined;
    if (!request) throw new Error('G711Decoder: request is required');
    if (request.track.codecFamily !== 'g711') {
      throw new Error('G711Decoder: request track must be G.711');
    }

    const durationUs = request.rangeEndUs - request.rangeStartUs;
    if (durationUs > DECODE_LIMITS.maxAudioDurationUs) {
      throw new Error(
        `G711Decoder: requested duration ${durationUs} us exceeds limit ${DECODE_LIMITS.maxAudioDurationUs} us`,
      );
    }

    const law = request.decoderConfig.bitstreamFormat === 'g711_alaw' ? 'alaw' : 'ulaw';
    const sampleRate = request.track.sampleRate ?? 8_000;
    const channels = request.track.channels ?? 1;
    const diagnostics = [...request.diagnostics];
    const chunks: Int16Array[] = [];
    let ptsUs = request.rangeStartUs;

    for (const packet of request.decodePackets) {
      chunks.push(decodeG711(packet.data, law));
      ptsUs = Math.min(ptsUs, packet.ptsUs);
    }

    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const interleaved = new Int16Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      interleaved.set(chunk, offset);
      offset += chunk.length;
    }

    const planes = int16ToFloat32Planar(interleaved, channels);
    const trimmed = trimPcmToRange({
      planes,
      sampleRate,
      channels,
      ptsUs,
      rangeStartUs: request.rangeStartUs,
      rangeEndUs: request.rangeEndUs,
    });

    const clip: PcmAudioClip = {
      clipId: `${request.requestId}:pcm`,
      sourceTrackId: request.track.trackId,
      ptsUs: trimmed.ptsUs,
      durationUs: trimmed.durationUs,
      sampleCount: trimmed.sampleCount,
      sampleRate,
      channels,
      format: 'f32-planar',
      planes: trimmed.planes,
      channelLayout: request.track.channelLayout,
      backend: G711_SOFTWARE_BACKEND,
      diagnostics,
    };

    ctx.log.info(`G711Decoder: ${clip.sampleCount} sample(s)`);
    return { pcm: clip };
  },
};
