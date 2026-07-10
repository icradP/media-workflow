/**
 * Auto-detect container format and dispatch to the appropriate parser.
 */

import type { MediaAnalysisResult, MediaAsset, MediaSource } from '@media-workflow/core';
import { detectContainerFormat, type DetectedFormat } from './detect.js';
import { parseFlvFileForAnalysis } from './flv/analysis.js';
import { parseMpegTsForAnalysis } from './ts/analysis.js';
import { parseMpegPsForAnalysis } from './ps/analysis.js';
import { parseIsoBmffForAnalysis } from './mp4/analysis.js';
import { parseMinimalAudioByFormat } from './audio/minimal.js';
import { normalizeAnalysis, probeMediaSource } from './normalize.js';

export function analyzeByDetectedFormat(fileBytes: Uint8Array): MediaAnalysisResult {
  const format = detectContainerFormat(fileBytes);
  return parseByFormat(fileBytes, format);
}

export function analyzeMediaSource(source: MediaSource): MediaAsset {
  const startedAt = performance.now();
  const probe = probeMediaSource(source);
  const legacy = parseByFormat(source.data, probe.format);
  return normalizeAnalysis(source, probe, legacy, performance.now() - startedAt);
}

function parseByFormat(fileBytes: Uint8Array, format: DetectedFormat): MediaAnalysisResult {
  switch (format) {
    case 'flv':
      return parseFlvFileForAnalysis(fileBytes);
    case 'mpegts':
      return parseMpegTsForAnalysis(fileBytes);
    case 'mpegps':
      return parseMpegPsForAnalysis(fileBytes);
    case 'mp4':
      return parseIsoBmffForAnalysis(fileBytes);
    case 'wav':
    case 'flac':
    case 'mp3':
    case 'opus':
      return parseMinimalAudioByFormat(fileBytes, format);
    default:
      return {
        format: { container: 'unknown', subtype: '', details: {} },
        streams: [],
        frames: [],
        formatSpecific: { detectedFormat: format },
      };
  }
}
