import assert from "node:assert/strict";
import { test } from "node:test";
import { parseConfigMarkdown, renderConfigMarkdown } from "../src/services/configMarkdown.ts";

const r1 = "!\n! Last configuration change at 13:51:33 EST Mon Aug 17 2026\n!\nhostname r1\n!\nend\n";
const doc = (devices: Parameters<typeof renderConfigMarkdown>[0]["devices"]) =>
  renderConfigMarkdown({ title: "lesson 3", lab: "OSPF lab", savedAt: new Date(2026, 8, 29, 10, 15, 0), devices });

test("render has title, metadata and one section per device; only the type as device metadata", () => {
  const md = doc([{ name: "r1", type: "iouRouter", config: r1 }]);
  assert.match(md, /^# lesson 3\n\n- Lab: OSPF lab\n- Saved: 2026-09-29 10:15:00\n/);
  assert.match(md, /\n## r1\n\n- Type: iouRouter\n\n```text\n!\n/);
});

test("render -> parse round-trips devices, types and configs", () => {
  const devices = [
    { name: "r1", type: "iouRouter", config: r1 },
    { name: "vpc1", type: "vpc", config: "hostname vpc1\nip address dhcp\n" },
  ];
  assert.deepEqual(parseConfigMarkdown(doc(devices)), devices);
});

test("banner delimiters: 0x03 in nvram, ^C in Markdown, 0x03 again after parse", () => {
  const config = "banner motd \x03Authorized only\x03\nbanner login \x03\nline one\nline two\n\x03\nend\n";
  const md = doc([{ name: "r1", config }]);
  assert.ok(!md.includes("\x03") && md.includes("banner motd ^CAuthorized only^C"));
  assert.equal(parseConfigMarkdown(md)[0].config, config);
});

test("^C outside a banner stays literal", () => {
  const md = "## r1\n```\ninterface e0/0\n description press ^C to stop\nend\n```\n";
  assert.equal(parseConfigMarkdown(md)[0].config, "interface e0/0\n description press ^C to stop\nend\n");
});

test("a config containing backticks gets a longer fence and survives", () => {
  const config = "description use ```code``` here\nend\n";
  const md = doc([{ name: "r1", config }]);
  assert.ok(md.includes("````text"));
  assert.equal(parseConfigMarkdown(md)[0].config, config);
});

test("notes, other code blocks and deeper headings are ignored", () => {
  const md = [
    "# Lab guide", "Some notes.", "```", "## not-a-device", "```",
    "## r1", "Configure OSPF first.", "### Hints", "```text", "hostname r1", "```", "```text", "second block ignored", "```",
    "## r2", "no code block here",
  ].join("\n");
  assert.deepEqual(parseConfigMarkdown(md), [{ name: "r1", config: "hostname r1\n" }]);
});

test("duplicate names are kept in order for the caller", () => {
  const md = "## r1\n```\nhostname a\n```\n## r1\n```\nhostname b\n```\n";
  assert.deepEqual(parseConfigMarkdown(md).map((d) => d.config), ["hostname a\n", "hostname b\n"]);
});

test("an empty code block is an explicitly blank device", () => {
  assert.deepEqual(parseConfigMarkdown("## r1\n```text\n```\n"), [{ name: "r1", config: "" }]);
  assert.deepEqual(parseConfigMarkdown(doc([{ name: "r1", config: "" }])), [{ name: "r1", config: "" }]);
});

test("CRLF files parse like LF", () => {
  assert.deepEqual(parseConfigMarkdown("## r1\r\n- Type: iouSwitch\r\n```\r\nhostname s1\r\n```\r\n"),
    [{ name: "r1", type: "iouSwitch", config: "hostname s1\n" }]);
});

test("tilde fences and trailing heading hashes", () => {
  assert.deepEqual(parseConfigMarkdown("## r1 ##\n~~~\nhostname r1\n~~~\n"), [{ name: "r1", config: "hostname r1\n" }]);
});
