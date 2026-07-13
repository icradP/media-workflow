import { describe, expect, it } from 'vitest';
import { buildCaptureMediaSelection } from '@media-workflow/codec';

describe('capture selection', () => {
  it('builds an mp4-compatible media selection for microphone capture', () => {
    const session = {
      sessionId: 'capture:test',
      version: '1',
      durationUs: 5_000_000,
      label: 'Test capture',
    };
    const selection = buildCaptureMediaSelection({
      session,
      role: 'microphone',
      track: {
        trackId: 'capture:microphone:0',
        index: 1,
        kind: 'audio',
        codec: 'PCM',
        codecFamily: 'pcm',
        codecConfig: null,
        sampleRate: 48_000,
        channels: 1,
        sampleCount: 240_000,
        durationUs: 5_000_000,
        timeBase: { numerator: 1, denominator: 48_000 },
        metadata: { captureRole: 'microphone' },
      },
    });

    expect(selection.selectedTrack.asset.container.format).toBe('mp4');
    expect(selection.rangeEndUs).toBe(5_000_000);
    expect(selection.selectedTrack.track.kind).toBe('audio');
  });
});
