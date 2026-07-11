import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DECODER_CAPABILITIES,
  extractTransferablesFromDecodedOutput,
  findDecoderCapability,
} from '@media-workflow/core/decoder';
import {
  createMemoryCache,
  executeGraph,
  type MediaSource,
  type NodeDefinition,
} from '@media-workflow/core';
import { instantiateWorkflowPreset, type WorkflowPreset } from '../preset.js';
import { fileLoaderNode } from '../source/file_loader.js';
import { nodeRegistry } from '../registry.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const workflowsDir = join(root, 'packages', 'nodes', 'presets');

describe('decode pipeline nodes', () => {
  it('registers planner, decoder, encoder and export nodes', () => {
    const ids = [
      'video_frame_request',
      'audio_range_request',
      'decoded_frame_selector',
      'webcodecs_video_decoder',
      'webcodecs_audio_decoder',
      'g711_decoder',
      'yuv_preview',
      'wav_encoder',
      'raw_yuv_exporter',
      'file_export',
    ];
    for (const id of ids) {
      expect(nodeRegistry.has(id)).toBe(true);
    }
  });

  it('exposes decoder capabilities for supported codecs', () => {
    expect(DECODER_CAPABILITIES.length).toBeGreaterThanOrEqual(3);
    expect(findDecoderCapability('h264', 'avcc')?.id).toBe('webcodecs-h264');
    expect(findDecoderCapability('aac', 'adts')?.id).toBe('webcodecs-aac');
    expect(findDecoderCapability('g711', 'g711_ulaw')?.id).toBe('g711-software');
  });

  it('extracts transferables from decoded outputs', () => {
    const buffer = new ArrayBuffer(16);
    const transferables = extractTransferablesFromDecodedOutput({
      frames: {
        requestId: 'req',
        backend: DECODER_CAPABILITIES[0]!,
        frames: [{
          frameId: 'f1',
          sourceSampleId: 's1',
          ptsUs: 0,
          codedWidth: 2,
          codedHeight: 2,
          displayWidth: 2,
          displayHeight: 2,
          format: 'I420',
          planes: [new Uint8Array(buffer)],
          strides: [2],
          metadata: {},
        }],
        diagnostics: [],
      },
    });
    expect(transferables).toContain(buffer);
  });
});

describe('decode workflow presets', () => {
  it('plans a first-keyframe video decode request for FLV', async () => {
    const preset = readPreset('decode-first-keyframe.workflow.json');
    const source = sourceFromFixture('tests/869247060193353-ok.flv');
    const results = await runPreset(preset, source);
    const request = results.get('request-frame')?.get('request') as {
      targetSampleIds: string[];
      decodePackets: Array<{ isKey: boolean }>;
    } | undefined;
    expect(request?.targetSampleIds.length).toBe(1);
    expect(request?.decodePackets.some(packet => packet.isKey)).toBe(true);
  });

  it('plans a 5-second audio decode range for FLV', async () => {
    const preset = readPreset('decode-audio-range.workflow.json');
    const source = sourceFromFixture('tests/869247060193353-ok.flv');
    const results = await runPreset(preset, source);
    const request = results.get('request-audio')?.get('request') as {
      rangeStartUs: number;
      rangeEndUs: number;
      decodePackets: unknown[];
    } | undefined;
    expect(request?.rangeStartUs).toBe(737_399_000);
    expect(request?.rangeEndUs).toBe(742_399_000);
    expect(request?.decodePackets.length).toBeGreaterThan(0);
  });
});

async function runPreset(
  preset: WorkflowPreset,
  source: MediaSource,
) {
  const sourceNode: NodeDefinition = {
    ...fileLoaderNode,
    async execute() {
      return { source };
    },
  } as NodeDefinition;
  const graph = instantiateWorkflowPreset(preset, {
    nodeOverrides: new Map([['file', sourceNode]]),
  });
  return executeGraph(
    graph,
    createMemoryCache(),
    new AbortController().signal,
  );
}

function sourceFromFixture(relativePath: string): MediaSource {
  const data = new Uint8Array(readFileSync(join(root, relativePath)));
  const sha256 = createHash('sha256').update(data).digest('hex');
  return {
    sourceId: `fixture:${sha256}`,
    version: sha256,
    kind: 'file',
    name: relativePath,
    size: data.byteLength,
    data,
    metadata: {},
  };
}

function readPreset(fileName: string): WorkflowPreset {
  return JSON.parse(
    readFileSync(join(workflowsDir, fileName), 'utf8'),
  ) as WorkflowPreset;
}
