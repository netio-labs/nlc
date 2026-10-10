import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { ensureIourc } from "../src/services/iou.ts";
import { labRuntimeDir, nodeRuntimeDir } from "../src/services/runtime.ts";

const labId = `test-${crypto.randomUUID()}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nlc-iourc-"));

after(() => {
  fs.rmSync(labRuntimeDir(labId), { recursive: true, force: true });
  fs.rmSync(tmp, { recursive: true, force: true });
});

function nodeDir(nodeId: string): string {
  const dir = nodeRuntimeDir(labId, nodeId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

test("a missing iourc is not an error and links nothing", () => {
  const dir = nodeDir("n1");
  ensureIourc(labId, "n1", path.join(tmp, "missing-iourc"));
  assert.equal(fs.existsSync(path.join(dir, "iourc")), false);
});

test("an existing iourc is linked into the node dir", () => {
  const dir = nodeDir("n2");
  const iourc = path.join(tmp, "iourc");
  fs.writeFileSync(iourc, "[license]\n");
  ensureIourc(labId, "n2", iourc);
  assert.equal(fs.readlinkSync(path.join(dir, "iourc")), iourc);
});
