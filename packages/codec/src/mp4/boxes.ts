import { asciiBytes, concatBytes, writeI32, writeU16, writeU32, writeU8 } from '../binary/utils.js';

function writeI16(value: number): Uint8Array {
  const arr = new Uint8Array(2);
  new DataView(arr.buffer).setInt16(0, value, false);
  return arr;
}

function writeU24(value: number): Uint8Array {
  const arr = new Uint8Array(3);
  arr[0] = (value >> 16) & 0xff;
  arr[1] = (value >> 8) & 0xff;
  arr[2] = value & 0xff;
  return arr;
}

export function box(type: string, ...payload: Uint8Array[]): Uint8Array {
  const body = concatBytes(...payload);
  return concatBytes(writeU32(8 + body.byteLength), asciiBytes(type), body);
}

export function fullBox(
  type: string,
  version: number,
  flags: number,
  ...payload: Uint8Array[]
): Uint8Array {
  return box(
    type,
    writeU8(version),
    writeU8((flags >> 16) & 0xff),
    writeU8((flags >> 8) & 0xff),
    writeU8(flags & 0xff),
    ...payload,
  );
}

export function encodeDescriptorLength(length: number): Uint8Array {
  const bytes: number[] = [];
  let value = length;
  do {
    bytes.unshift(value & 0x7f);
    value >>= 7;
  } while (value > 0);
  for (let index = 0; index < bytes.length - 1; index++) {
    bytes[index]! |= 0x80;
  }
  return new Uint8Array(bytes);
}

export function buildEsds(asc: Uint8Array, objectTypeIndication = 0x40): Uint8Array {
  return buildEsdsWithOti(asc, objectTypeIndication);
}

export function buildEsdsMp3(): Uint8Array {
  return buildEsdsWithOti(new Uint8Array(0), 0x6b);
}

function buildEsdsWithOti(decSpecificInfo: Uint8Array, objectTypeIndication: number): Uint8Array {
  const decoderSpecific = concatBytes(
    writeU8(0x05),
    encodeDescriptorLength(decSpecificInfo.byteLength),
    decSpecificInfo,
  );
  const decoderConfig = concatBytes(
    writeU8(0x04),
    encodeDescriptorLength(15 + decoderSpecific.byteLength),
    writeU8(objectTypeIndication),
    writeU8(0x15),
    writeU24(0),
    writeU32(0),
    writeU32(0),
    decoderSpecific,
  );
  const esDescriptor = concatBytes(
    writeU8(0x03),
    encodeDescriptorLength(3 + decoderConfig.byteLength + 3),
    writeU16(0),
    writeU8(0),
    decoderConfig,
    writeU8(0x06),
    writeU8(0x01),
    writeU8(0x02),
  );
  return fullBox('esds', 0, 0, esDescriptor);
}

export function buildFtyp(): Uint8Array {
  return box(
    'ftyp',
    asciiBytes('isom'),
    writeU32(0),
    asciiBytes('isom'),
    asciiBytes('iso2'),
    asciiBytes('avc1'),
    asciiBytes('mp41'),
  );
}

export function buildMvhd(
  durationTicks: number,
  timeScale: number,
  nextTrackId: number,
): Uint8Array {
  const creation = writeU32(0);
  const matrix = concatBytes(
    writeU32(0x00010000),
    writeU32(0),
    writeU32(0),
    writeU32(0),
    writeU32(0x00010000),
    writeU32(0),
    writeU32(0),
    writeU32(0),
    writeU32(0x40000000),
  );
  return fullBox(
    'mvhd',
    0,
    0,
    creation,
    creation,
    writeU32(timeScale),
    writeU32(Math.max(1, Math.round(durationTicks))),
    writeU32(0x00010000),
    writeU16(0x0100),
    writeU16(0),
    writeI32(0),
    writeI32(0),
    matrix,
    new Uint8Array(24),
    writeU32(nextTrackId),
  );
}

export function buildTkhd(
  trackId: number,
  durationTicks: number,
  timeScale: number,
  width: number,
  height: number,
  isAudio: boolean,
): Uint8Array {
  const creation = writeU32(0);
  const matrix = concatBytes(
    writeU32(0x00010000),
    writeU32(0),
    writeU32(0),
    writeU32(0),
    writeU32(0x00010000),
    writeU32(0),
    writeU32(0),
    writeU32(0),
    writeU32(0x40000000),
  );
  const trackDuration = writeU32(Math.max(1, Math.round(durationTicks)));
  return fullBox(
    'tkhd',
    0,
    isAudio ? 0x00000001 : 0x00000003,
    creation,
    creation,
    writeU32(trackId),
    new Uint8Array(4),
    trackDuration,
    new Uint8Array(8),
    writeI16(0),
    writeI16(isAudio ? 0x0100 : 0),
    writeI16(0),
    writeI16(0),
    matrix,
    writeU32((width || 0) << 16),
    writeU32((height || 0) << 16),
  );
}

export function buildMdhd(
  durationTicks: number,
  timeScale: number,
  language = 'und',
): Uint8Array {
  const creation = writeU32(0);
  const lang =
    ((language.charCodeAt(0) & 0x1f) << 10) |
    ((language.charCodeAt(1) & 0x1f) << 5) |
    (language.charCodeAt(2) & 0x1f);
  return fullBox(
    'mdhd',
    0,
    0,
    creation,
    creation,
    writeU32(timeScale),
    writeU32(Math.max(1, Math.round(durationTicks))),
    writeU16(lang),
    writeU16(0),
  );
}

export function buildHdlr(handlerType: 'vide' | 'soun'): Uint8Array {
  return fullBox(
    'hdlr',
    0,
    0,
    new Uint8Array(4),
    asciiBytes(handlerType),
    new Uint8Array(12),
    asciiBytes(handlerType === 'vide' ? 'VideoHandler' : 'SoundHandler'),
    writeU8(0),
  );
}

export function buildVmhd(): Uint8Array {
  return fullBox('vmhd', 0, 1, writeU16(0), writeU16(0), writeU16(0), writeU16(0));
}

export function buildSmhd(): Uint8Array {
  return fullBox('smhd', 0, 0, writeU16(0), writeU16(0));
}

export function buildDref(): Uint8Array {
  const url = fullBox('url ', 0, 1);
  const dref = fullBox('dref', 0, 0, writeU32(1), url);
  return box('dinf', dref);
}

export function buildStsdVideo(
  width: number,
  height: number,
  avcC: Uint8Array,
  codecString: string,
): Uint8Array {
  const entryType = codecString.startsWith('avc1') ? 'avc1' : 'avc1';
  const avcCBox = box('avcC', avcC);
  const entry = concatBytes(
    writeU32(8 + 78 + avcCBox.byteLength),
    asciiBytes(entryType),
    new Uint8Array(6),
    writeU16(1),
    writeU16(0),
    writeU16(0),
    writeU32(0),
    writeU32(0),
    writeU32(0),
    writeU16(width),
    writeU16(height),
    writeU32(0x00480000),
    writeU32(0x00480000),
    writeU32(0),
    writeU16(1),
    new Uint8Array(32),
    writeU16(0x0018),
    writeU16(0xffff),
    avcCBox,
  );
  return fullBox('stsd', 0, 0, writeU32(1), entry);
}

export function buildStsdAudio(
  channels: number,
  sampleRate: number,
  asc: Uint8Array,
): Uint8Array {
  return buildStsdMp4aAudio(channels, sampleRate, buildEsds(asc));
}

export function buildStsdMp3Audio(
  channels: number,
  sampleRate: number,
): Uint8Array {
  return buildStsdMp4aAudio(channels, sampleRate, buildEsdsMp3());
}

function buildStsdMp4aAudio(
  channels: number,
  sampleRate: number,
  esds: Uint8Array,
): Uint8Array {
  const entry = concatBytes(
    writeU32(8 + 28 + esds.byteLength),
    asciiBytes('mp4a'),
    new Uint8Array(6),
    writeU16(1),
    writeU16(0),
    writeU16(0),
    writeU32(0),
    writeU16(channels),
    writeU16(16),
    writeU16(0),
    writeU16(0),
    writeU32(sampleRate << 16),
    esds,
  );
  return fullBox('stsd', 0, 0, writeU32(1), entry);
}

export function buildStts(deltas: number[]): Uint8Array {
  const entries: { count: number; delta: number }[] = [];
  for (const delta of deltas) {
    const value = Math.max(1, Math.round(delta));
    const last = entries[entries.length - 1];
    if (last && last.delta === value) last.count += 1;
    else entries.push({ count: 1, delta: value });
  }
  const payload = [writeU32(entries.length)];
  for (const entry of entries) {
    payload.push(writeU32(entry.count), writeU32(entry.delta));
  }
  return fullBox('stts', 0, 0, ...payload);
}

export function buildStsc(sampleCount: number): Uint8Array {
  return fullBox(
    'stsc',
    0,
    0,
    writeU32(1),
    writeU32(1),
    writeU32(sampleCount),
    writeU32(1),
  );
}

export function buildStsz(sizes: number[]): Uint8Array {
  const payload = [writeU32(0), writeU32(sizes.length)];
  for (const size of sizes) payload.push(writeU32(size));
  return fullBox('stsz', 0, 0, ...payload);
}

export function buildStco(offsets: number[]): Uint8Array {
  const payload = [writeU32(offsets.length)];
  for (const offset of offsets) payload.push(writeU32(offset));
  return fullBox('stco', 0, 0, ...payload);
}

export function buildStss(keySampleIndexes: number[]): Uint8Array {
  const payload = [writeU32(keySampleIndexes.length)];
  for (const index of keySampleIndexes) payload.push(writeU32(index));
  return fullBox('stss', 0, 0, ...payload);
}

export function buildStbl(...children: Uint8Array[]): Uint8Array {
  return box('stbl', ...children);
}

export function buildMinf(isAudio: boolean, stbl: Uint8Array): Uint8Array {
  return box(
    'minf',
    isAudio ? buildSmhd() : buildVmhd(),
    buildDref(),
    stbl,
  );
}

export function buildMdia(
  mdhd: Uint8Array,
  hdlr: Uint8Array,
  minf: Uint8Array,
): Uint8Array {
  return box('mdia', mdhd, hdlr, minf);
}

export function buildTrak(tkhd: Uint8Array, mdia: Uint8Array): Uint8Array {
  return box('trak', tkhd, mdia);
}

export function buildMoov(...children: Uint8Array[]): Uint8Array {
  return box('moov', ...children);
}

export function buildMdat(payload: Uint8Array): Uint8Array {
  return box('mdat', payload);
}

export function microsecondsToTicks(microseconds: number, timeScale: number): number {
  return (microseconds * timeScale) / 1_000_000;
}

export function movieTimeScale(trackTimeScales: number[]): number {
  return Math.max(1, ...trackTimeScales);
}
