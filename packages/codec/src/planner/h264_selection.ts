import type {
  MediaSample,
  MediaSelection,
  SelectedTrack,
  VideoMediaTrack,
} from '@media-workflow/core';
import { buildDecoderConfig } from '../packet/config.js';
import type { H264EncodeResult } from '../encode/h264.js';
import { stableSelectionId } from './selection.js';

export function buildH264MediaSelection(
  sourceSelection: MediaSelection,
  encoded: H264EncodeResult,
): MediaSelection {
  const { asset, track: sourceTrack } = sourceSelection.selectedTrack;
  if (sourceTrack.kind !== 'video') {
    throw new Error(`H.264 selection: source track ${sourceTrack.trackId} is not video`);
  }

  const trackId = `${sourceTrack.trackId}:h264`;
  const track: VideoMediaTrack = {
    trackId,
    index: sourceTrack.index,
    kind: 'video',
    codec: 'H.264',
    codecFamily: 'h264',
    codecConfig: encoded.codecConfig,
    width: encoded.width,
    height: encoded.height,
    frameRate: inferFrameRate(encoded),
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
    dtsUs: packet.dtsUs,
    durationUs: packet.durationUs,
    offset: 0,
    size: packet.data.byteLength,
    isKey: packet.isKey,
    data: packet.data,
    metadata: {
      bitstreamFormat: 'avcc',
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

function inferFrameRate(encoded: H264EncodeResult): number {
  if (encoded.packets.length < 2) return 30;
  const durationUs = Math.max(
    1,
    (encoded.packets.at(-1)!.ptsUs - encoded.packets[0]!.ptsUs)
      + encoded.packets.at(-1)!.durationUs,
  );
  return Math.max(1, Math.round((encoded.packets.length * 1_000_000) / durationUs));
}
