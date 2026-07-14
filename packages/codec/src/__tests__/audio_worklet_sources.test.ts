import { describe, expect, it } from 'vitest';
import { PCM_RING_WORKLET_NAME, PCM_RING_WORKLET_SOURCE } from '../audio/pcm_ring_worklet.js';
import { CAPTURE_WORKLET_NAME, CAPTURE_WORKLET_SOURCE } from '../capture/capture_worklet.js';

describe('AudioWorklet sources', () => {
  it('pcm ring worklet registers AudioWorkletProcessor (no ScriptProcessor)', () => {
    expect(PCM_RING_WORKLET_SOURCE).toContain(`registerProcessor('${PCM_RING_WORKLET_NAME}'`);
    expect(PCM_RING_WORKLET_SOURCE).toContain('AudioWorkletProcessor');
    expect(PCM_RING_WORKLET_SOURCE).not.toContain('ScriptProcessor');
    expect(PCM_RING_WORKLET_SOURCE).not.toContain('createScriptProcessor');
  });

  it('capture worklet registers AudioWorkletProcessor (no ScriptProcessor)', () => {
    expect(CAPTURE_WORKLET_SOURCE).toContain(`registerProcessor('${CAPTURE_WORKLET_NAME}'`);
    expect(CAPTURE_WORKLET_SOURCE).toContain('AudioWorkletProcessor');
    expect(CAPTURE_WORKLET_SOURCE).not.toContain('ScriptProcessor');
    expect(CAPTURE_WORKLET_SOURCE).not.toContain('createScriptProcessor');
  });
});
