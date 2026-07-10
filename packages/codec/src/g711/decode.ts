/**
 * G.711 μ-law / A-law decoding.
 */

/** μ-law → linear 16-bit PCM lookup */
const MULAW_DECODE: Int16Array = (() => {
  const table = new Int16Array(256);
  for (let i = 0; i < 256; i++) {
    const val = ~i;
    const sign = (val & 0x80) ? -1 : 1;
    const exponent = (val >> 4) & 0x07;
    const mantissa = val & 0x0f;
    const sample = sign * ((mantissa << 3) + 132) * (1 << exponent) - 132 * sign;
    table[i] = sample as number;
  }
  return table;
})();

/** A-law → linear 16-bit PCM lookup */
const ALAW_DECODE: Int16Array = (() => {
  const table = new Int16Array(256);
  for (let i = 0; i < 256; i++) {
    const val = i ^ 0x55;
    const exponent = (val & 0x70) >> 4;
    const mantissa = (val & 0x0f) << 1;
    let sample: number;
    if (exponent === 0) {
      sample = mantissa;
    } else {
      sample = (mantissa + 256) * (1 << (exponent - 1));
    }
    table[i] = ((val & 0x80) ? -sample : sample) as number;
  }
  return table;
})();

export type G711Law = 'ulaw' | 'alaw';

export function decodeG711(input: Uint8Array, law: G711Law = 'ulaw'): Int16Array {
  const table = law === 'alaw' ? ALAW_DECODE : MULAW_DECODE;
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    output[i] = table[input[i]!]!;
  }
  return output;
}
