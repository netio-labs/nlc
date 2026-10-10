import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { buildNvram, readNvramConfig, uncompressLzw } from "../src/services/nvram.ts";

const fixture = (name: string) => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url));

test("plain config round-trips, including banner delimiters and UTF-8", () => {
  const config = "!\nhostname r1\n!\nbanner motd \x03Authorized access only\x03\ninterface Ethernet0/0\n description 上联\n!\nend\n";
  const image = buildNvram(config, 64);
  assert.equal(image.length, 64 * 1024);
  assert.deepEqual(readNvramConfig(image), { status: "ok", config });
});

test("image size follows the nvram setting", () => {
  assert.equal(buildNvram("hostname r1\n", 128).length, 128 * 1024);
});

test("a never-written nvram reads as empty", () => {
  assert.deepEqual(readNvramConfig(Buffer.alloc(64 * 1024)), { status: "empty" });
});

test("a corrupted image is reported, not returned", () => {
  const image = buildNvram("hostname r1\n", 64);
  image[40] ^= 0xff;
  assert.deepEqual(readNvramConfig(image), { status: "bad-checksum" });
});

test("a config that does not fit is rejected", () => {
  assert.throws(() => buildNvram("x".repeat(64 * 1024), 64), /does not fit/);
});

test("LZW (Unix compress) matches the reference output", () => {
  assert.equal(uncompressLzw(fixture("l2-config.Z")).toString("utf8"), fixture("l2-config.txt").toString("utf8"));
});

test("compressed (format 2) nvram written by an L2 image reads back as text", () => {
  // Same layout as buildNvram, with the compressed payload and format 2.
  const payload = fixture("l2-config.Z");
  const image = buildNvram("x".repeat(payload.length), 64);
  payload.copy(image, 36);
  image.writeUInt16BE(2, 2);
  let sum = 0;
  for (let i = 0; i < image.length; i += 2) if (i !== 4) sum += image.readUInt16BE(i);
  while (sum >> 16) sum = (sum & 0xffff) + (sum >> 16);
  image.writeUInt16BE(sum ^ 0xffff, 4);
  assert.deepEqual(readNvramConfig(image), { status: "ok", config: fixture("l2-config.txt").toString("utf8") });
});
