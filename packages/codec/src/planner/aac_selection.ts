import type {
  AudioMediaTrack,
  MediaSample,
  MediaSelection,
  SelectedTrack,
} from '@media-workflow/core';
import { buildDecoderConfig } from '../packet/config.js';
import type { AacEncodeResult } from '../encode/aac.js';
import { stableSelectionId } from './selection.js';

export function buildAacMediaSelection(
  sourceSelection: MediaSelection,
  encoded: AacEncodeResult,
): MediaSelection {
  const { asset, track: sourceTrack } = sourceSelection.selectedTrack;
  if (sourceTrack.kind !== 'audio') {
    throw new Error(`AAC selection: source track ${sourceTrack.trackId} is not audio`);
  }

  const trackId = `${sourceTrack.trackId}:aac`;
  const track: AudioMediaTrack = {
    trackId,
    index: sourceTrack.index,
    kind: 'audio',
    codec: 'AAC',
    codecFamily: 'aac',
    codecConfig: encoded.codecConfig,
    sampleRate: encoded.sampleRate,
    channels: encoded.channels,
    profile: 'AAC-LC',
    sampleCount: encoded.packets.length,
    durationUs: sourceSelection.rangeEndUs !== undefined
      ? Math.max(1, sourceSelection.rangeEndUs - sourceSelection.rangeStartUs)
      : encoded.packets.reduce((sum, packet) => sum + packet.durationUs, 0),
    metadata: {
      transcodeSourceTrackId: sourceTrack.trackId,
      transcodeCodec: encoded.codec,
    },
  };
  track.decoderConfig = buildDecoderConfig(track, 'mp4');

  const samples: MediaSample[] = encoded.packets.map((packet, index) => ({
    sampleId: `${trackId}:${index}`,
    index,
    trackId,
    ptsUs: packet.ptsUs,
    dtsUs: packet.ptsUs,
    durationUs: packet.durationUs,
    offset: 0,
    size: packet.data.byteLength,
    isKey: packet.isKey,
    data: packet.data,
    metadata: {
      bitstreamFormat: 'aac_raw',
    },
  }));

  const selectedTrack: SelectedTrack = {
    selectedTrackId: [
      asset.source.sourceId,
      asset.source.version,
      trackId,
    ].join(':'),
    asset,
    track,
    samples,
    diagnostics: [],
  };

  const selectionId = stableSelectionId({
    sourceId: asset.source.sourceId,
    sourceVersion: asset.source.version,
    trackId,
    parentSelectionId: sourceSelection.selectionId,
    packetCount: samples.length,
  });

  return {
    selectionId,
    selectedTrack,
    samples,
    rangeStartUs: sourceSelection.rangeStartUs,
    rangeEndUs: sourceSelection.rangeEndUs,
    criteria: sourceSelection.criteria,
    diagnostics: [...sourceSelection.diagnostics],
  };
}
