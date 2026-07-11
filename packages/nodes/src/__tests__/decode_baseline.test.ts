import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isWebCodecsAvailable, packI420Planes } from '@media-workflow/codec';
import { WORKFLOW_PRESET_CATALOG } from '../presets/catalog.js';
import { executeFirstKeyframeDecodeWorkflow } from './decode_workflow.js';

interface DecodeVideoBaseline {
  available: boolean;
  width: number | null;
  height: number | null;
  byteLength: number;
  sha256: string;
  outputFile: string;
  error?: string;
}

interface DecodeBaselineRecord {
  input: { file: string; size: number; sha256: string };
  video: DecodeVideoBaseline;
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const decodeFixturesDir = join(root, 'tests', 'fixtures', 'decode');
const records = readdirSync(decodeFixturesDir)
  .filter(fileName => fileName.endsWith('.decode.json'))
  .sort()
  .map(fileName =>
    JSON.parse(readFileSync(join(decodeFixturesDir, fileName), 'utf8')) as DecodeBaselineRecord,
  );

describe('decode workflow design', () => {
  it('instantiates every catalog workflow preset', async () => {
    const { instantiateWorkflowPreset } = await import('../preset.js');
    for (const entry of WORKFLOW_PRESET_CATALOG) {
      if (!entry.preset) continue;
      expect(() => instantiateWorkflowPreset(entry.preset)).not.toThrow();
    }
  });

  it('loads the first-keyframe display preset with decoder and preview nodes', async () => {
    const { instantiateWorkflowPreset } = await import('../preset.js');
    const preset = JSON.parse(
      readFileSync(
        join(root, 'packages', 'nodes', 'presets', 'decode-first-keyframe-display.workflow.json'),
        'utf8',
      ),
    );
    const graph = instantiateWorkflowPreset(preset);
    expect([...graph.nodes.keys()]).toEqual([
      'file',
      'analyze',
      'select-video',
      'request-frame',
      'decode-video',
      'select-decoded',
      'preview-yuv',
    ]);
    expect(graph.edges).toHaveLength(7);
  });
});

describe('ffmpeg decode baselines', () => {
  it.each(records.filter(record => record.video.available))(
    'fixture metadata: $input.file',
    record => {
      const yuvBytes = readFileSync(join(root, record.video.outputFile));
      expect(yuvBytes.byteLength).toBe(record.video.byteLength);
      expect(createHash('sha256').update(yuvBytes).digest('hex')).toBe(record.video.sha256);
    },
  );
});

describe.skipIf(!isWebCodecsAvailable())('first keyframe decode vs ffmpeg', () => {
  it.each(records.filter(record => record.video.available))(
    '$input.file',
    async record => {
      const sourceBytes = readFileSync(join(root, record.input.file));
      expect(createHash('sha256').update(sourceBytes).digest('hex')).toBe(record.input.sha256);

      const frame = await executeFirstKeyframeDecodeWorkflow(sourceBytes, record.input.file);
      const packed = packI420Planes(frame);

      expect(frame.displayWidth).toBe(record.video.width);
      expect(frame.displayHeight).toBe(record.video.height);
      expect(packed.byteLength).toBe(record.video.byteLength);
      expect(createHash('sha256').update(packed).digest('hex')).toBe(record.video.sha256);
    },
    60_000,
  );
});
