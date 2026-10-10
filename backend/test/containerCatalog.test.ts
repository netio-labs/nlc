import assert from "node:assert/strict";
import { test } from "node:test";
import {
  loadContainerCatalog,
  matchContainerCatalog,
  normalizeRepo,
  parseContainerCatalog,
} from "../src/services/containerCatalog.ts";

test("repository name drops registry, library/, tag and digest", () => {
  assert.equal(normalizeRepo("docker.io/library/alpine:latest"), "alpine");
  assert.equal(normalizeRepo("alpine"), "alpine");
  assert.equal(normalizeRepo("localhost/ceos:4.36.1F"), "ceos");
  assert.equal(normalizeRepo("quay.io/frrouting/frr:10.1"), "frrouting/frr");
  assert.equal(normalizeRepo("docker.io/frrouting/frr@sha256:abcd"), "frrouting/frr");
  assert.equal(normalizeRepo("reg:5000/team/img:t"), "team/img");
  assert.equal(normalizeRepo("frrouting/frr"), "frrouting/frr"); // first part without '.'/':' is not a registry
  assert.equal(normalizeRepo("Localhost/cEOS64:4.32"), "ceos64");
});

const catalog = parseContainerCatalog([
  { id: "ceos", label: "cEOS", match: ["*ceos*"], shell: "Cli -p 15" },
  { id: "frr", label: "FRR", match: ["frrouting/frr", "frr"] },
  { id: "default", label: "Default", command: ["sleep", "infinity"] },
]);

test("first matching entry wins; unmatched images fall back to default", () => {
  const id = (ref: string) => matchContainerCatalog(catalog, ref).id;
  assert.equal(id("localhost/ceos:4.36.1F"), "ceos");
  assert.equal(id("arista/cEOS64-lab:4.32"), "ceos");
  assert.equal(id("docker.io/frrouting/frr:latest"), "frr");
  assert.equal(id("myreg.local/frr:9"), "frr");
  assert.equal(id("docker.io/library/alpine:latest"), "default");
  assert.equal(id("someone/frr-exporter:1"), "default"); // globs match the whole name
  assert.equal(id("weird.chars+name/x"), "default"); // regex specials in names are literal
});

test("invalid catalogs are rejected with the offending entry named", () => {
  const bad = (raw: unknown, msg: RegExp) =>
    assert.throws(() => parseContainerCatalog(raw), (e: Error & { code?: string }) => e.code === "CONTAINER_CATALOG_INVALID" && msg.test(e.message));
  bad({}, /array/);
  bad([{ id: "x", label: "X", match: ["x"] }], /"default" entry is required/);
  bad([{ id: "default", label: "D" }, { id: "default", label: "D" }], /duplicate/);
  bad([{ id: "default", label: "D" }, { id: "x", label: "X", match: ["x"], runArgs: "--privileged" }], /entry "x": runArgs must be an array/);
  bad([{ id: "default", label: "D" }, { id: "x", label: "X" }], /entry "x": match must not be empty/);
  bad([{ id: "default", label: "D", match: ["*"] }], /default entry takes no match/);
  bad([{ id: "Bad Id", label: "X" }], /id must match/);
});

test("the shipped catalog is valid", () => {
  const shipped = loadContainerCatalog();
  assert.equal(matchContainerCatalog(shipped, "docker.io/frrouting/frr:latest").shell, "vtysh");
  assert.equal(matchContainerCatalog(shipped, "localhost/ceos:4.36.1F").shell, "Cli -p 15");
  assert.equal(matchContainerCatalog(shipped, "localhost/crpd:23.2R1.13").shell, "cli");
  assert.equal(matchContainerCatalog(shipped, "localhost/ios-xr/xrd-control-plane:26.2.2").id, "xrd");
  // vRouter only takes PCI/DPDK interfaces, never veth links
  assert.equal(matchContainerCatalog(shipped, "localhost/ios-xr/xrd-vrouter:26.2.2").id, "default");
  const fallback = matchContainerCatalog(shipped, "docker.io/library/alpine:latest");
  assert.deepEqual([fallback.command, fallback.shell], [["sleep", "infinity"], "/bin/sh"]);
});
