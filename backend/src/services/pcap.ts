/**
 * Shared PCAP format helpers used by the capture stream and sharkd.
 */

export function makePcapGlobalHeader(dlt: number): Buffer {
  const buf = Buffer.alloc(24);
  buf.writeUInt32LE(0xa1b2c3d4, 0); // magic
  buf.writeUInt16LE(2, 4);           // major version
  buf.writeUInt16LE(4, 6);           // minor version
  buf.writeInt32LE(0, 8);            // timezone offset (UTC)
  buf.writeUInt32LE(0, 12);          // timestamp accuracy
  buf.writeUInt32LE(65535, 16);      // max capture length
  buf.writeUInt32LE(dlt, 20);        // link-layer type
  return buf;
}

export function wrapPcapPacket(payload: Buffer): Buffer {
  const tsMs = Date.now();
  const hdr = Buffer.alloc(16);
  hdr.writeUInt32LE(Math.floor(tsMs / 1000), 0);
  hdr.writeUInt32LE((tsMs % 1000) * 1000, 4);
  hdr.writeUInt32LE(payload.length, 8);
  hdr.writeUInt32LE(payload.length, 12);
  return Buffer.concat([hdr, payload]);
}
