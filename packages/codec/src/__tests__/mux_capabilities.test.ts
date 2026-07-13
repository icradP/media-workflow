import { describe, expect, it } from 'vitest';
import type { AudioMediaTrack } from '@media-workflow/core';
import {
  formatMuxAudioError,
  MP4_MUX_DIRECT_AUDIO,
  MP4_MUX_TRANSCODE_WORKFLOW,
} from '../mp4/capabilities.js';

describe('MP4 mux capabilities', () => {
  it('lists supported formats in G.711 audio errors', () => {
    const track: AudioMediaTrack = {
      trackId: 'flv:audio:audio',
      index: 0,
      kind: 'audio',
      codec: 'G.711 A-law',
      codecFamily: 'g711',
      codecConfig: null,
      sampleRate: 8000,
      channels: 1,
      sampleCount: 1,
      metadata: {},
    };
    const message = formatMuxAudioError(track);
    expect(message).toContain('G.711');
    expect(message).toContain(MP4_MUX_TRANSCODE_WORKFLOW);
    expect(message).toContain(MP4_MUX_DIRECT_AUDIO[0]!);
  });
});
