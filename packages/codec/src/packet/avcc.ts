export function buildAvcCFromNalus(
  sps: Uint8Array,
  pps: Uint8Array,
  lengthSizeMinusOne = 3,
): Uint8Array {
  const profile = sps[1] ?? 0x42;
  const compat = sps[2] ?? 0x00;
  const level = sps[3] ?? 0x1e;
  const chunks: number[] = [
    1,
    profile,
    compat,
    level,
    0xfc | (lengthSizeMinusOne & 0x03),
    0xe0 | 1,
    (sps.byteLength >> 8) & 0xff,
    sps.byteLength & 0xff,
    ...sps,
    1,
    (pps.byteLength >> 8) & 0xff,
    pps.byteLength & 0xff,
    ...pps,
  ];
  return new Uint8Array(chunks);
}
