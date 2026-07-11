import type {
  AudioDecodeRequest,
  NodeDefinition,
  PcmAudioClip,
} from '@media-workflow/core';
import {
  DECODE_LIMITS,
  WEBCODECS_AAC_BACKEND,
} from '@media-workflow/core/decoder';
import {
  concatPlanarFloat32,
  float32InterleavedToPlanar,
  isWebCodecsAudioAvailable,
  trimPcmToRange,
} from '@media-workflow/codec';

export const webcodecsAudioDecoderNode: NodeDefinition<
  { request: 'audio_decode_request' },
  { pcm: 'pcm_audio' }
> = {
  id: 'webcodecs_audio_decoder',
  category: 'decoder',
  displayName: 'WebCodecs Audio Decoder',
  description: 'Decode AAC audio ranges using the browser WebCodecs API.',
  inputs: {
    request: { type: 'audio_decode_request', label: 'Audio Decode Request' },
  },
  outputs: {
    pcm: { type: 'pcm_audio', label: 'PCM Audio Clip' },
  },
  worker: 'decoder',
  async execute(ctx, { inputs }) {
    const request = inputs.request as AudioDecodeRequest | undefined;
    if (!request) throw new Error('WebCodecsAudioDecoder: request is required');
    if (!isWebCodecsAudioAvailable()) {
      throw new Error('WebCodecsAudioDecoder: WebCodecs AudioDecoder is not available');
    }

    const durationUs = request.rangeEndUs - request.rangeStartUs;
    if (durationUs > DECODE_LIMITS.maxAudioDurationUs) {
      throw new Error(
        `WebCodecsAudioDecoder: requested duration ${durationUs} us exceeds limit ${DECODE_LIMITS.maxAudioDurationUs} us`,
      );
    }

    const diagnostics = [...request.diagnostics];
    const channelChunks: Float32Array[][] = [];
    let sampleRate = request.track.sampleRate ?? request.decoderConfig.sampleRate ?? 48_000;
    let channels = request.track.channels ?? request.decoderConfig.channels ?? 2;
    let ptsUs = request.rangeStartUs;

    const decoder = new AudioDecoder({
      output: audioData => {
        const frameChannels = audioData.numberOfChannels;
        const frameRate = audioData.sampleRate;
        const frameCount = audioData.numberOfFrames;
        const interleaved = new Float32Array(frameCount * frameChannels);
        audioData.copyTo(interleaved, { planeIndex: 0, format: 'f32' });
        channelChunks.push(float32InterleavedToPlanar(interleaved, frameChannels));
        sampleRate = frameRate;
        channels = frameChannels;
        ptsUs = Math.min(ptsUs, Math.round(audioData.timestamp));
        audioData.close();
      },
      error: error => {
        diagnostics.push({
          severity: 'error',
          code: 'decoder.webcodecs.audio_error',
          message: error.message,
        });
      },
    });

    decoder.configure({
      codec: request.decoderConfig.codec,
      description: request.decoderConfig.description,
      sampleRate,
      numberOfChannels: channels,
    });

    for (const packet of request.decodePackets) {
      if (ctx.signal.aborted) break;
      const chunk = new EncodedAudioChunk({
        type: packet.isKey ? 'key' : 'delta',
        timestamp: packet.ptsUs,
        duration: packet.durationUs,
        data: packet.data,
      });
      decoder.decode(chunk);
    }

    await decoder.flush();
    decoder.close();

    const mergedPlanes = concatPlanarFloat32(channelChunks);
    const trimmed = trimPcmToRange({
      planes: mergedPlanes,
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
      sampleRate,
      channels,
      sampleCount: trimmed.sampleCount,
      format: 'f32-planar',
      planes: trimmed.planes,
      channelLayout: request.track.channelLayout,
      backend: WEBCODECS_AAC_BACKEND,
      diagnostics,
    };

    ctx.log.info(`WebCodecsAudioDecoder: ${clip.sampleCount} sample(s)`);
    return { pcm: clip };
  },
};
