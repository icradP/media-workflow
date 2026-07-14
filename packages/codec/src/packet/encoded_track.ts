import type {
  EncodedPacket,
  EncodedTrack,
  MediaSelection,
  VideoMediaTrack,
} from '@media-workflow/core';
import { sampleToEncodedPacket } from './normalize.js';

/**
 * Materialize an EncodedTrack from a media selection (no decode).
 * Packets are ordered by dts for WebCodecs feeding; presentation uses pts.
 */
export function buildEncodedTrackFromSelection(
  selection: MediaSelection,
): EncodedTrack {
  const { asset, track } = selection.selectedTrack;
  if (track.kind !== 'video' && track.kind !== 'audio') {
    throw new Error(
      `buildEncodedTrackFromSelection: track ${track.trackId} kind=${track.kind} is not A/V`,
    );
  }
  if (!track.decoderConfig) {
    throw new Error(
      `buildEncodedTrackFromSelection: track ${track.trackId} has no decoderConfig`,
    );
  }

  const containerFormat = asset.container.format;
  const bySampleId = new Map(
    selection.samples.map(sample => [sample.sampleId, sample]),
  );

  // Prefer presentation selection samples; fall back to track samples for the same ids.
  const sourceSamples = selection.samples.length > 0
    ? selection.samples
    : selection.selectedTrack.samples;

  const packets: EncodedPacket[] = [];
  for (const sample of sourceSamples) {
    const packet = sampleToEncodedPacket(sample, track, containerFormat);
    if (packet) packets.push(packet);
  }

  packets.sort((left, right) =>
    left.dtsUs - right.dtsUs
    || left.ptsUs - right.ptsUs
    || left.packetId.localeCompare(right.packetId),
  );

  const videoTrack = track.kind === 'video' ? track as VideoMediaTrack : undefined;

  return {
    trackId: track.trackId,
    kind: track.kind,
    codec: track.codec,
    codecFamily: track.codecFamily,
    decoderConfig: track.decoderConfig,
    packets,
    metadata: {
      selectionId: selection.selectionId,
      sampleCount: sourceSamples.length,
      packetCount: packets.length,
      missingPacketSamples: sourceSamples.length - packets.length,
      width: videoTrack?.width,
      height: videoTrack?.height,
      frameRate: videoTrack?.frameRate,
      selectedSampleIds: [...bySampleId.keys()],
    },
  };
}
