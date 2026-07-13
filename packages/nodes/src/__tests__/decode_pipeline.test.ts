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
  it('registers selection, task decoder, transform and export nodes', () => {
    const ids = [
      'track_select',
      'media_select',
      'video_decode',
      'audio_decode',
      'frame_extract',
      'video_preview',
      'sample_table',
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
  it('materializes a stable first-keyframe video selection for FLV', async () => {
    const preset = readPreset('decode-first-keyframe.workflow.json');
    const source = sourceFromFixture('tests/869247060193353-ok.flv');
    const results = await runPreset(preset, source);
    const selection = results.get('selection')?.get('selection') as {
      selectionId: string;
      samples: Array<{ isKey: boolean }>;
    } | undefined;
    expect(selection?.selectionId).toMatch(/^selection:/);
    expect(selection?.samples).toHaveLength(1);
    expect(selection?.samples[0]?.isKey).toBe(true);
  });

  it('materializes an exact five-second audio selection for FLV', async () => {
    const preset: WorkflowPreset = {
      version: 1,
      name: 'Audio selection',
      nodes: [
        { id: 'file', type: 'file_loader' },
        { id: 'analyze', type: 'auto_analyze' },
        {
          id: 'selection',
          type: 'media_select',
          params: {
            kind: 'audio',
            trackIndex: 0,
            startTimeSeconds: 0,
            endTimeSeconds: 5,
          },
        },
      ],
      edges: [
        {
          id: 'file-analyze',
          sourceNodeId: 'file',
          sourceOutput: 'source',
          targetNodeId: 'analyze',
          targetInput: 'source',
        },
        {
          id: 'analyze-selection',
          sourceNodeId: 'analyze',
          sourceOutput: 'asset',
          targetNodeId: 'selection',
          targetInput: 'source',
        },
      ],
    };
    const source = sourceFromFixture('tests/869247060193353-ok.flv');
    const results = await runPreset(preset, source);
    const selection = results.get('selection')?.get('selection') as {
      rangeStartUs: number;
      rangeEndUs?: number;
      samples: unknown[];
    } | undefined;
    expect(selection?.rangeStartUs).toBe(737_399_000);
    expect(selection?.rangeEndUs).toBe(742_399_000);
    expect(selection?.samples.length).toBeGreaterThan(0);
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
