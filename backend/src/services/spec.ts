/*
 * This module handles loading and validating lab specifications from JSON files.
 * It uses AJV to validate the structure of the spec against a JSON schema.
 * It also applies default values for IOU node configurations.
 */
import fs from "node:fs";
import path from "node:path";
import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import { CONFIG } from "../config.ts";
import type { LabSpec } from "../types/index.ts";
import { IOULIVE86_TYPE, validateIoulive86Links, validateIoulive86Node } from "./ioulive86.ts";
import { CONTAINER_TYPE, validateContainerNode } from "./container.ts";

const ajv = new Ajv2020({ allErrors: true, strict: false });
const schemaPath = path.join(CONFIG.rootDir, "schemas", "labv2.schema.json");
const labSchema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
const validateAgainstSchema = ajv.compile(labSchema);

function formatErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors || errors.length === 0) return "unknown validation error";
  return errors.map((err) => `${err.instancePath || "/"} ${err.message ?? ""}`.trim()).join("; ");
  // instancePath is a JSON Pointer to the part of the data that caused the error
  // message is a human-readable error message
}

export function validateLabSpecData(data: unknown): { ok: true; data: LabSpec } | { ok: false; error: string } {
  if (!validateAgainstSchema(data)) {
    return {
      ok: false,
      error: `Invalid lab spec: ${formatErrors(validateAgainstSchema.errors)}`,
    };
  }
  const spec = data as LabSpec;
  for (const node of spec.nodes) {
    const message =
      node.type === IOULIVE86_TYPE ? validateIoulive86Node(node)
      : node.type === CONTAINER_TYPE ? validateContainerNode(node)
      : null;
    if (message) {
      return { ok: false, error: `Invalid lab spec: ${message}` };
    }
  }
  const linkMessage = validateIoulive86Links(spec);
  if (linkMessage) return { ok: false, error: `Invalid lab spec: ${linkMessage}` };
  return { ok: true, data: spec };
}

function validateSpec(specPath: string): { ok: true; data: LabSpec } | { ok: false; error: string } {
  const raw = fs.readFileSync(specPath, "utf8");
  const data = JSON.parse(raw) as unknown;
  return validateLabSpecData(data);
}

function normalizeSpec(spec: LabSpec): LabSpec {
  const links = spec.links ?? [];
  const nodes = spec.nodes.map((node) => {
    if (node.type === "iou") {
      // Apply runtime defaults for IOU nodes.
      return {
        ...node,
        runtime: {
          ...CONFIG.iouRuntimeDefaults,
          ...node.runtime,
        },
      };
    } else {
      return node;
    }
  }) as LabSpec["nodes"];
  return { ...spec, nodes, links };
}

export function loadSpec(specPath: string): LabSpec {
  const result = validateSpec(specPath);
  if (!result.ok) {
    throw new Error(result.error);
  }
  return normalizeSpec(result.data);
}
