import { describe, expect, it } from 'vitest';
import type { DecodedVideoClip, LiveStreamHandle } from '@media-workflow/core';
import { videoPreviewNode } from '../display/video_preview.js';

function clip(): DecodedVideoClip {
  return {
    requestId: 'r1',
    backend: {
      id: 't',
      version: '0',
      api: 'mock',
      codecFamilies: [],
      inputFormats: [],
      outputFormats: ['I420'],
    },
    frames: [
      {
        frameId: 'f0',
        sourceSampleId: 's0',
        ptsUs: 0,
        codedWidth: 2,
        codedHeight: 2,
        displayWidth: 2,
        displayHeight: 2,
        format: 'I420',
        planes: [new Uint8Array(4), new Uint8Array(1), new Uint8Array(1)],
        strides: [2, 1, 1],
        metadata: {},
      },
    ],
    diagnostics: [],
  };
}

describe('videoPreviewNode', () => {
  it('accepts batch decoded_video', async () => {
    const result = await videoPreviewNode.execute(
      { log: { info() {}, warn() {}, error() {} }, nodeId: '1', runId: 't' } as never,
      { inputs: { video: clip(), stream: undefined }, params: { frameIndex: 0, continuous: true } },
    );
    const preview = JSON.parse(String(result.preview));
    expect(preview.mode).toBe('batch');
    expect(preview.backend).toBe('webgpu');
    expect(preview.displayWidth).toBe(2);
  });

  it('accepts live_stream only', async () => {
    const stream: LiveStreamHandle = {
      streamId: 'ring:test',
      origin: 'static',
      mediaKind: 'video',
      nodeDefinitionId: 'ring_buffer_source',
      params: {},
      hasVideo: true,
    };
    const result = await videoPreviewNode.execute(
      { log: { info() {}, warn() {}, error() {} }, nodeId: '1', runId: 't' } as never,
      { inputs: { video: undefined, stream }, params: { frameIndex: 0, continuous: true } },
    );
    const preview = JSON.parse(String(result.preview));
    expect(preview.mode).toBe('live-only');
    expect(preview.liveStreamId).toBe('ring:test');
  });
});
