#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const testsDir = join(root, 'tests');
const outputDir = join(testsDir, 'fixtures', 'ffprobe');
const supportedExtensions = new Set(['.flv', '.mp3', '.wav', '.mp4', '.ts']);
const requestedFiles = process.argv.slice(2).filter(argument => argument !== '--');

const fileNames = requestedFiles.length > 0
  ? requestedFiles
  : (await readdir(testsDir))
      .filter(fileName => supportedExtensions.has(extname(fileName).toLowerCase()))
      .sort();

const ffprobeVersion = commandVersion('ffprobe');
const ffmpegVersion = commandVersion('ffmpeg');

for (const fileName of fileNames) {
  const inputPath = resolve(testsDir, fileName);
  const info = await stat(inputPath);
  if (!info.isFile()) continue;

  const probe = run('ffprobe', [
    '-v', 'warning',
    '-count_frames',
    '-count_packets',
    '-show_format',
    '-show_streams',
    '-show_programs',
    '-show_chapters',
    '-of', 'json',
    inputPath,
  ]);
  const validation = run('ffmpeg', [
    '-hide_banner',
    '-nostdin',
    '-v', 'warning',
    '-i', inputPath,
    '-map', '0',
    '-f', 'null',
    '-',
  ]);
  const bytes = await readFile(inputPath);
  const parsedProbe = parseProbeJson(probe.stdout, fileName);
  if (parsedProbe.format?.filename) {
    parsedProbe.format.filename = relative(root, inputPath);
  }
  const expected = summarize(parsedProbe);
  const packetProbe = expected.streams.some(stream => stream.kind === 'video')
    ? run('ffprobe', [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_packets',
        '-show_data',
        '-show_entries', 'packet=pts,dts,pos,size,flags,data',
        '-of', 'json',
        inputPath,
      ])
    : null;
  if (packetProbe) {
    expected.firstKeyVideoPacket = extractFirstKeyVideoPacket(
      parseProbeJson(packetProbe.stdout, `${fileName} packets`),
    );
  }
  const record = {
    schemaVersion: 1,
    generator: {
      ffprobe: ffprobeVersion,
      ffmpeg: ffmpegVersion,
    },
    input: {
      file: relative(root, inputPath),
      size: info.size,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
    expected,
    probe: {
      exitCode: probe.status,
      warnings: lines(probe.stderr),
      data: parsedProbe,
    },
    decodeValidation: {
      exitCode: validation.status,
      warnings: lines(validation.stderr),
    },
    packetProbe: packetProbe
      ? { exitCode: packetProbe.status, warnings: lines(packetProbe.stderr) }
      : null,
  };
  const outputPath = join(outputDir, `${basename(fileName)}.ffprobe.json`);
  await writeFile(outputPath, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`Wrote ${relative(root, outputPath)}`);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function commandVersion(command) {
  const result = run(command, ['-version']);
  return result.stdout.split(/\r?\n/, 1)[0] ?? command;
}

function parseProbeJson(stdout, fileName) {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`Unable to parse ffprobe JSON for ${fileName}`, { cause: error });
  }
}

function summarize(probe) {
  const format = probe.format ?? {};
  const streams = Array.isArray(probe.streams) ? probe.streams : [];
  const programs = Array.isArray(probe.programs) ? probe.programs : [];
  return {
    format: {
      name: format.format_name ?? null,
      longName: format.format_long_name ?? null,
      startTimeSeconds: numeric(format.start_time),
      durationSeconds: numeric(format.duration),
      size: integer(format.size),
      bitrate: integer(format.bit_rate),
      probeScore: integer(format.probe_score),
      tags: format.tags ?? {},
    },
    streamCount: streams.length,
    programCount: programs.length,
    streams: streams.map(stream => ({
      index: stream.index,
      id: stream.id ?? null,
      kind: stream.codec_type ?? 'unknown',
      codec: stream.codec_name ?? 'unknown',
      profile: stream.profile ?? null,
      timeBase: stream.time_base ?? null,
      startTimeSeconds: numeric(stream.start_time),
      durationSeconds: numeric(stream.duration),
      bitrate: integer(stream.bit_rate),
      frameCount: integer(stream.nb_read_frames),
      packetCount: integer(stream.nb_read_packets),
      width: integer(stream.width),
      height: integer(stream.height),
      pixelFormat: stream.pix_fmt ?? null,
      frameRate: stream.avg_frame_rate ?? stream.r_frame_rate ?? null,
      sampleRate: integer(stream.sample_rate),
      channels: integer(stream.channels),
      channelLayout: stream.channel_layout ?? null,
      bitsPerSample: integer(stream.bits_per_sample),
      extradataSize: integer(stream.extradata_size),
      tags: stream.tags ?? {},
    })),
  };
}

function extractFirstKeyVideoPacket(probe) {
  const packet = (probe.packets ?? []).find(candidate =>
    String(candidate.flags ?? '').includes('K'),
  );
  if (!packet) return null;
  const data = bytesFromFfprobeDump(String(packet.data ?? ''));
  return {
    pts: integer(packet.pts),
    dts: integer(packet.dts),
    pos: integer(packet.pos),
    size: integer(packet.size),
    sha256: createHash('sha256').update(data).digest('hex'),
    hexPrefix: Buffer.from(data.subarray(0, 512)).toString('hex'),
  };
}

function bytesFromFfprobeDump(dump) {
  const hex = dump
    .split(/\r?\n/)
    .map(line => {
      const colon = line.indexOf(':');
      if (colon < 0) return '';
      return line
        .slice(colon + 1)
        .trim()
        .split(/\s{2,}/, 1)[0]
        .replace(/\s+/g, '');
    })
    .join('');
  return Uint8Array.from(hex.match(/.{2}/g)?.map(byte => Number.parseInt(byte, 16)) ?? []);
}

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function integer(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function lines(value) {
  return value
    .split(/\r?\n/)
    .map(line => line.trim().replace(/@ 0x[0-9a-f]+/gi, '@ <ptr>'))
    .filter(Boolean);
}
