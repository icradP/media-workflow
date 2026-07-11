export function int16ToFloat32Planar(
  interleaved: Int16Array,
  channels: number,
): Float32Array[] {
  const sampleCount = Math.floor(interleaved.length / channels);
  const planes = Array.from({ length: channels }, () => new Float32Array(sampleCount));
  for (let sample = 0; sample < sampleCount; sample++) {
    for (let channel = 0; channel < channels; channel++) {
      planes[channel]![sample] = interleaved[sample * channels + channel]! / 32_768;
    }
  }
  return planes;
}

export function float32InterleavedToPlanar(
  interleaved: Float32Array,
  channels: number,
): Float32Array[] {
  const sampleCount = Math.floor(interleaved.length / channels);
  const planes = Array.from({ length: channels }, () => new Float32Array(sampleCount));
  for (let sample = 0; sample < sampleCount; sample++) {
    for (let channel = 0; channel < channels; channel++) {
      planes[channel]![sample] = interleaved[sample * channels + channel]!;
    }
  }
  return planes;
}

export function concatPlanarFloat32(chunks: Float32Array[][]): Float32Array[] {
  if (chunks.length === 0) return [];
  const channels = chunks[0]!.length;
  const lengths = chunks.map(chunk => chunk[0]?.length ?? 0);
  const total = lengths.reduce((sum, length) => sum + length, 0);
  const result = Array.from({ length: channels }, () => new Float32Array(total));
  let offset = 0;
  for (const chunk of chunks) {
    const length = chunk[0]?.length ?? 0;
    for (let channel = 0; channel < channels; channel++) {
      result[channel]!.set(chunk[channel] ?? new Float32Array(length), offset);
    }
    offset += length;
  }
  return result;
}
