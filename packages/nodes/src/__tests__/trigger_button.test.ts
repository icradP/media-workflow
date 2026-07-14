import { describe, expect, it } from 'vitest';
import type { ExecuteContext } from '@media-workflow/core';
import { isLiveGraphNodeId, triggerButtonNode } from '../realtime/index.js';
import { mp4MuxerNode } from '../encoder/mp4_muxer.js';

const ctx: ExecuteContext = {
  signal: new AbortController().signal,
  log: { debug() {}, info() {}, warn() {}, error() {} },
  resources: { track() {}, disposeAll() {} },
};

describe('trigger_button + mux record gates', () => {
  it('registers as a Live graph node and emits a control pulse handle', async () => {
    expect(isLiveGraphNodeId('trigger_button')).toBe(true);
    const result = await triggerButtonNode.execute(ctx, {
      inputs: {},
      params: { label: '● Start' },
    });
    expect(result.out.nodeDefinitionId).toBe('trigger_button');
    expect(result.out.lastEvent?.kind).toBe('pulse');
  });

  it('mp4_muxer exposes recordStart / recordStop gate pins', () => {
    expect(mp4MuxerNode.inputs.recordStart?.type).toBe('control');
    expect(mp4MuxerNode.inputs.recordStop?.type).toBe('control');
    expect(mp4MuxerNode.inputs.audioIn?.type).toBe('webaudio');
    expect('control' in mp4MuxerNode.inputs).toBe(false);
  });

  it('batch execute rejects live-only mux wiring', async () => {
    await expect(
      mp4MuxerNode.execute(ctx, {
        inputs: {
          video: undefined,
          audio: undefined,
          asset: undefined,
          videoStream: {
            streamId: 's',
            origin: 'device',
            mediaKind: 'av',
            nodeDefinitionId: 'device_capture',
            params: {},
          },
          audioStream: undefined,
          audioIn: undefined,
          recordStart: {
            controlId: 'c',
            nodeDefinitionId: 'trigger_button',
          },
          recordStop: undefined,
        },
        params: { fileName: 'x.mp4' },
      }),
    ).rejects.toThrow(/Live Play/);
  });
});
