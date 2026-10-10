import assert from "node:assert/strict";
import { test } from "node:test";
import { expandVolumes, validateContainerNode } from "../src/services/container.ts";
import type { LabSpec } from "../src/types/index.ts";

test("{{volume:<name>}} expands to a per-node volume, once per name", () => {
  const { args, volumes } = expandVolumes("n1", ["-v", "{{volume:config}}:/config", "-v", "{{volume:log}}:/var/log", "--mount", "src={{volume:config}}"]);
  assert.deepEqual(args, ["-v", "nlc-n1-config:/config", "-v", "nlc-n1-log:/var/log", "--mount", "src=nlc-n1-config"]);
  assert.deepEqual(volumes, ["nlc-n1-config", "nlc-n1-log"]);
});

const node = (runArgs: string[]) =>
  ({ id: "n1", name: "c1", type: "container", image: "alpine", runtime: { runArgs }, interfaces: [{ family: "ethernet", uiPrefix: "eth", slotCount: 1, portsPerSlot: 1 }] }) as unknown as LabSpec["nodes"][number];

test("runArgs accept only {{volume:<name>}} placeholders", () => {
  assert.equal(validateContainerNode(node(["--privileged", "-v", "{{volume:config}}:/etc/frr"])), null);
  for (const bad of ["{{volume}}:/etc/frr", "{{volume:}}:/x", "{{volume:-x}}:/x", "{{node}}"]) {
    assert.match(validateContainerNode(node(["-v", bad])) ?? "", /only placeholder is \{\{volume:<name>\}\}/, bad);
  }
});
