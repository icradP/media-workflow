import { describe, expect, it } from 'vitest';
import { formatFrameSelectorRange } from './frame_selector_ui.js';

describe('frame selector timeline labels', () => {
  it('formats an open-ended time range', () => {
    expect(
      formatFrameSelectorRange({
        startTimeSeconds: 0.08,
        endTimeSeconds: -1,
      }),
    ).toBe('0.08s – 末尾');
  });

  it('includes sample count when preview data exists', () => {
    expect(
      formatFrameSelectorRange(
        { startTimeSeconds: 0, endTimeSeconds: 1.5 },
        { sampleCount: 144, durationSeconds: 2, trackLabel: 'flv:video:video' },
      ),
    ).toBe('0.00s – 1.50s · 144 帧');
  });
});
