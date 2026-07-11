import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createMemoryCache,
  executeGraph,
  type DecodedVideoFrame,
  type MediaSource,
  type NodeDefinition,
} from '@media-workflow/core';
import { instantiateWorkflowPreset, type WorkflowPreset } from '../preset.js';
import { fileLoaderNode } from '../source/file_loader.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const presetsDir = join(root, 'presets');

export async function executeFirstKeyframeDecodeWorkflow(
  data: Uint8Array,
  name: string,
): Promise<DecodedVideoFrame> {
  const sha256 = createHash('sha256').update(data).digest('hex');
  const source: MediaSource = {
    sourceId: `fixture:${sha256}`,
    version: sha256,
    kind: 'file',
    name,
    size: data.byteLength,
    data,
    metadata: {},
  };

  const preset = readPreset('decode-first-keyframe-display.workflow.json');
  const sourceNode: NodeDefinition = {
    ...fileLoaderNode,
    async execute() {
      return { source };
    },
  } as NodeDefinition;

  const graph = instantiateWorkflowPreset(preset, {
    nodeOverrides: new Map([['file', sourceNode]]),
  });
  const results = await executeGraph(
    graph,
    createMemoryCache(),
    new AbortController().signal,
  );

  const frame = results.get('select-decoded')?.get('frame') as DecodedVideoFrame | undefined;
  if (!frame) {
    throw new Error('Decode workflow did not produce a decoded frame');
  }
  return frame;
}

function readPreset(fileName: string): WorkflowPreset {
  return JSON.parse(
    readFileSync(join(presetsDir, fileName), 'utf8'),
  ) as WorkflowPreset;
}
