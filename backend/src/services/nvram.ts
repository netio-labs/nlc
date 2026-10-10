/*
 * IOU nvram image codec: read the startup-config out of nvram_NNNNN, and build
 * an nvram image holding a given startup-config.
 *
 * Layout (big-endian; verified against real 15.7 / 15.2 L2 / IOL 17.16 images):
 *   [0]  startup header, 36 bytes: magic 0xABCD, format (1 = plain, 2 = Unix
 *        compress), checksum, IOS version, start addr, end addr, length, ...
 *   [36] startup-config (length bytes), padded to 4
 *        private-config header, 16 bytes: magic 0xFEDC, format, start, end, length
 *        private-config bytes
 * An nvram that never had a config written starts with zero words.
 * The checksum is the one's-complement sum of the whole image as 16-bit words,
 * skipping the checksum field itself, then inverted.
 */

const STARTUP_MAGIC = 0xabcd;
const PRIVATE_MAGIC = 0xfedc;
const FORMAT_PLAIN = 1;
const FORMAT_COMPRESSED = 2;
const HEADER_LEN = 36;
const PRIVATE_HEADER_LEN = 16;
// Written into generated images; IOU ignores it (15.2 / 15.7 / 17.16 all boot with any value).
const IOS_VERSION = 0x0f07;
const BASE_ADDRESS = 0x10000000;

export type NvramRead =
  | { status: "ok"; config: string }
  | { status: "empty" }                 // nothing written yet (or erased)
  | { status: "bad-checksum" }          // e.g. read while the device was writing
  | { status: "invalid"; reason: string };

function pad4(n: number): number {
  return (4 - (n % 4)) % 4;
}

function checksum(image: Buffer, checksumOffset: number): number {
  let sum = 0;
  for (let i = 0; i + 1 < image.length; i += 2) {
    if (i === checksumOffset) continue;
    sum += image.readUInt16BE(i);
  }
  while (sum >> 16) sum = (sum & 0xffff) + (sum >> 16);
  return sum ^ 0xffff;
}

export function readNvramConfig(image: Buffer): NvramRead {
  let offset = 0;
  while (offset + 2 <= image.length && image.readUInt16BE(offset) === 0) offset += 2;
  if (offset + HEADER_LEN > image.length) return { status: "empty" };
  if (image.readUInt16BE(offset) !== STARTUP_MAGIC) return { status: "empty" };

  if (image.readUInt16BE(offset + 4) !== checksum(image, offset + 4)) return { status: "bad-checksum" };
  const format = image.readUInt16BE(offset + 2);
  const length = image.readUInt32BE(offset + 16);
  const start = offset + HEADER_LEN;
  if (start + length > image.length) return { status: "invalid", reason: "config length exceeds image" };
  const data = image.subarray(start, start + length);

  if (format === FORMAT_PLAIN) return { status: "ok", config: data.toString("utf8") };
  if (format === FORMAT_COMPRESSED) {
    try {
      return { status: "ok", config: uncompressLzw(data).toString("utf8") };
    } catch (err) {
      return { status: "invalid", reason: err instanceof Error ? err.message : "decompression failed" };
    }
  }
  return { status: "invalid", reason: `unknown config format ${format}` };
}

/** nvram image of sizeKb KB holding config (uncompressed) and an empty private-config. */
export function buildNvram(config: string, sizeKb: number): Buffer {
  const cfg = Buffer.from(config, "utf8");
  const image = Buffer.alloc(sizeKb * 1024);
  const privateOffset = HEADER_LEN + cfg.length + pad4(cfg.length);
  if (privateOffset + PRIVATE_HEADER_LEN > image.length) {
    throw new Error(`Configuration (${cfg.length} bytes) does not fit in ${sizeKb} KB of nvram.`);
  }
  const start = BASE_ADDRESS + HEADER_LEN;
  image.writeUInt16BE(STARTUP_MAGIC, 0);
  image.writeUInt16BE(FORMAT_PLAIN, 2);
  image.writeUInt16BE(IOS_VERSION, 6);
  image.writeUInt32BE(start, 8);
  image.writeUInt32BE(start + cfg.length, 12);
  image.writeUInt32BE(cfg.length, 16);
  cfg.copy(image, HEADER_LEN);

  const privateStart = BASE_ADDRESS + privateOffset + PRIVATE_HEADER_LEN;
  image.writeUInt16BE(PRIVATE_MAGIC, privateOffset);
  image.writeUInt16BE(FORMAT_PLAIN, privateOffset + 2);
  image.writeUInt32BE(privateStart, privateOffset + 4);
  image.writeUInt32BE(privateStart, privateOffset + 8);   // empty: end == start
  image.writeUInt32BE(0, privateOffset + 12);

  image.writeUInt16BE(checksum(image, 4), 4);
  return image;
}

/**
 * Unix compress (.Z, LZW) decoder — what IOS uses for compressed configs
 * (`service compress-config`). Follows ncompress: codes are packed LSB-first,
 * start at 9 bits; whenever the code width grows or a CLEAR arrives the input
 * skips ahead to a multiple of (width * 8) bits, counted from the previous
 * such realignment point.
 */
export function uncompressLzw(input: Buffer): Buffer {
  if (input.length < 3 || input[0] !== 0x1f || input[1] !== 0x9d) throw new Error("not Unix compress data");
  const maxBits = input[2] & 0x1f;
  const blockMode = (input[2] & 0x80) !== 0;
  if (maxBits < 9 || maxBits > 16) throw new Error(`unsupported max code width ${maxBits}`);
  const CLEAR = 256;
  const FIRST = blockMode ? 257 : 256;
  const maxMaxCode = 1 << maxBits;

  const prefix = new Uint16Array(maxMaxCode);
  const suffix = new Uint8Array(maxMaxCode);
  for (let i = 0; i < 256; i++) suffix[i] = i;

  const totalBits = input.length * 8;
  let base = 3 * 8;           // realignment reference (starts right after the header)
  let pos = base;
  let nBits = 9;
  let maxCode = (1 << nBits) - 1;
  let freeEnt = FIRST;
  let oldCode = -1;
  let finChar = 0;
  const out: number[] = [];
  const stack: number[] = [];

  const realign = () => {
    const unit = nBits * 8;
    const rel = pos - base;
    pos = base + (rel === 0 ? 0 : Math.ceil(rel / unit) * unit);
    base = pos;
  };
  const readCode = (): number => {
    let code = 0;
    for (let i = 0; i < nBits; i++) {
      const bit = pos + i;
      if (input[bit >> 3] & (1 << (bit & 7))) code |= 1 << i;
    }
    pos += nBits;
    return code;
  };

  while (pos + nBits <= totalBits) {
    if (freeEnt > maxCode) {
      realign();
      nBits++;
      maxCode = nBits === maxBits ? maxMaxCode : (1 << nBits) - 1;
      continue;
    }
    const code = readCode();
    if (oldCode === -1) {
      if (code >= 256) throw new Error("corrupt compressed data");
      finChar = oldCode = code;
      out.push(code);
      continue;
    }
    if (code === CLEAR && blockMode) {
      freeEnt = FIRST - 1;
      realign();
      nBits = 9;
      maxCode = (1 << nBits) - 1;
      continue;
    }
    let cur = code;
    if (cur >= freeEnt) {                 // KwKwK case
      if (cur > freeEnt) throw new Error("corrupt compressed data");
      stack.push(finChar);
      cur = oldCode;
    }
    while (cur >= 256) {
      stack.push(suffix[cur]);
      cur = prefix[cur];
    }
    finChar = suffix[cur];
    stack.push(finChar);
    while (stack.length) out.push(stack.pop()!);
    if (freeEnt < maxMaxCode) {
      prefix[freeEnt] = oldCode;
      suffix[freeEnt] = finChar;
      freeEnt++;
    }
    oldCode = code;
  }
  return Buffer.from(out);
}
