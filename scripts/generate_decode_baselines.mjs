#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const testsDir = join(root, 'tests');
const outputDir = join(testsDir, 'fixtures', 'decode');
const supportedExtensions = new Set(['.flv', '.mp4', '.ts']);
const requestedFiles = process.argv.slice(2).filter(argument => argument !== '--');

const fileNames = requestedFiles.length > 0
  ? requestedFiles
  : ['generated-av.flv', 'generated-av.mp4', 'test.ts'];

const ffmpegVersion = commandVersion('ffmpeg');

await mkdir(outputDir, { recursive: true });

for (const fileName of fileNames) {
  const inputPath = resolve(testsDir, fileName);
  const bytes = await readFile(inputPath);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const baseName = basename(fileName, extname(fileName));
  const recordName = basename(fileName);
  const record = {
    schemaVersion: 1,
    generator: { ffmpeg: ffmpegVersion },
    input: {
      file: relative(root, inputPath),
      size: bytes.byteLength,
      sha256,
    },
    video: await extractFirstKeyYuv(inputPath, baseName),
    audio: await extractAudioPcm(inputPath, baseName),
    wav: await extractAudioWav(inputPath, baseName),
  };
  await writeFile(
    join(outputDir, `${recordName}.decode.json`),
    `${JSON.stringify(record, null, 2)}\n`,
    'utf8',
  );
  console.log(`Wrote ${recordName}.decode.json`);
}

async function extractFirstKeyYuv(inputPath, baseName) {
  const outputPath = join(outputDir, `${baseName}.first-key.yuv`);
  const result = run('ffmpeg', [
    '-hide_banner',
    '-nostdin',
    '-v', 'error',
    '-i', inputPath,
    '-vf', 'select=eq(pict_type\\,I)',
    '-frames:v', '1',
    '-pix_fmt', 'yuv420p',
    '-f', 'rawvideo',
    outputPath,
  ]);
  if (result.status !== 0) {
    return { available: false, error: result.stderr.trim() };
  }
  const data = await readFile(outputPath);
  const probe = run('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-of', 'json',
    inputPath,
  ]);
  const parsed = JSON.parse(probe.stdout || '{}');
  const stream = parsed.streams?.[0];
  return {
    available: true,
    width: stream?.width ?? null,
    height: stream?.height ?? null,
    byteLength: data.byteLength,
    sha256: createHash('sha256').update(data).digest('hex'),
    outputFile: relative(root, outputPath),
  };
}

async function extractAudioPcm(inputPath, baseName) {
  const outputPath = join(outputDir, `${baseName}.5s.f32le.pcm`);
  const result = run('ffmpeg', [
    '-hide_banner',
    '-nostdin',
    '-v', 'error',
    '-i', inputPath,
    '-map', '0:a:0?',
    '-t', '5',
    '-ac', '2',
    '-ar', '48000',
    '-f', 'f32le',
    outputPath,
  ]);
  if (result.status !== 0) {
    return { available: false, error: result.stderr.trim() };
  }
  const data = await readFile(outputPath);
  return {
    available: true,
    sampleRate: 48_000,
    channels: 2,
    sampleCount: Math.floor(data.byteLength / 4 / 2),
    byteLength: data.byteLength,
    sha256: createHash('sha256').update(data).digest('hex'),
    outputFile: relative(root, outputPath),
  };
}

async function extractAudioWav(inputPath, baseName) {
  const outputPath = join(outputDir, `${baseName}.5s.wav`);
  const result = run('ffmpeg', [
    '-hide_banner',
    '-nostdin',
    '-v', 'error',
    '-i', inputPath,
    '-map', '0:a:0?',
    '-t', '5',
    '-ac', '2',
    '-ar', '48000',
    outputPath,
  ]);
  if (result.status !== 0) {
    return { available: false, error: result.stderr.trim() };
  }
  const data = await readFile(outputPath);
  const probe = run('ffprobe', [
    '-v', 'error',
    '-show_entries', 'stream=codec_name,sample_rate,channels,duration',
    '-of', 'json',
    outputPath,
  ]);
  const parsed = JSON.parse(probe.stdout || '{}');
  const stream = parsed.streams?.[0];
  return {
    available: true,
    codec: stream?.codec_name ?? null,
    sampleRate: stream?.sample_rate ? Number(stream.sample_rate) : null,
    channels: stream?.channels ?? null,
    durationSeconds: stream?.duration ? Number(stream.duration) : null,
    byteLength: data.byteLength,
    sha256: createHash('sha256').update(data).digest('hex'),
    outputFile: relative(root, outputPath),
  };
}

function run(command, args) {
  return spawnSync(command, args, { encoding: 'utf8' });
}

function commandVersion(command) {
  const result = run(command, ['-version']);
  return (result.stdout || result.stderr || '').split('\n')[0]?.trim() ?? 'unknown';
}
