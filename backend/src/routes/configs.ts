/*
 * Route handlers for saved device configurations of a lab (see services/configs.ts).
 * Mounted at /v1/labs/:labId/configs.
 */

import type { FastifyInstance, FastifyReply } from "fastify";
import {
  appError,
  replaceConfig,
  deleteConfig,
  getErrorCode,
  hasLabSpecFile,
  importConfig,
  listConfigs,
  loadLabSpec,
  matchConfig,
  normalizeConfigName,
  parseConfigMarkdown,
  readConfig,
  saveConfigFromDevices,
  writeConfig,
} from "../services/index.ts";

const ERROR_STATUS: Record<string, number> = {
  INVALID_CONFIG_NAME: 400,
  INVALID_BODY: 400,
  CONFIG_NOT_FOUND: 404,
  CONFIG_EXISTS: 409,
  LAB_NOT_LOADED: 409,
  NO_CONFIG_TO_SAVE: 422,
};

type Params = { labId: string; name?: string };

async function handle(reply: FastifyReply, labId: string, status: number, run: () => unknown | Promise<unknown>) {
  if (!hasLabSpecFile(labId)) {
    return reply.status(404).send({ ok: false, error: { code: "LAB_NOT_FOUND", message: `Lab ${labId} not found.` } });
  }
  try {
    return reply.status(status).send({ ok: true, data: await run() });
  } catch (err) {
    const code = getErrorCode(err);
    if (code && ERROR_STATUS[code]) {
      return reply.status(ERROR_STATUS[code]).send({ ok: false, error: { code, message: (err as Error).message } });
    }
    throw err;
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") throw appError("INVALID_BODY", `"${field}" must be a string.`);
  return value;
}

export async function configsRoutes(app: FastifyInstance) {
  app.get("/", async (req, reply) => {
    const { labId } = req.params as Params;
    return handle(reply, labId, 200, () => listConfigs(labId));
  });

  // Read every device's saved config (nvram / startup.cfg) into a new configuration.
  app.post("/", async (req, reply) => {
    const { labId } = req.params as Params;
    const body = (req.body ?? {}) as { name?: unknown; overwrite?: unknown };
    return handle(reply, labId, 201, () => saveConfigFromDevices(labId, normalizeConfigName(body.name), body.overwrite === true));
  });

  app.post("/import", async (req, reply) => {
    const { labId } = req.params as Params;
    const body = (req.body ?? {}) as { name?: unknown; markdown?: unknown; overwrite?: unknown };
    return handle(reply, labId, 201, () =>
      importConfig(labId, normalizeConfigName(body.name), requireString(body.markdown, "markdown"), body.overwrite === true),
    );
  });

  // Replace the startup configurations of the lab's stopped devices.
  app.post("/replace", async (req, reply) => {
    const { labId } = req.params as Params;
    const { name } = (req.body ?? {}) as { name?: unknown };
    return handle(reply, labId, 200, () => replaceConfig(labId, normalizeConfigName(name)));
  });

  app.get("/:name", async (req, reply) => {
    const { labId, name } = req.params as Params;
    return handle(reply, labId, 200, () => {
      const markdown = readConfig(labId, name!);
      return { name: normalizeConfigName(name), markdown, report: matchConfig(loadLabSpec(labId), parseConfigMarkdown(markdown)) };
    });
  });

  // Save an edited configuration (must exist).
  app.put("/:name", async (req, reply) => {
    const { labId, name } = req.params as Params;
    const { markdown } = (req.body ?? {}) as { markdown?: unknown };
    return handle(reply, labId, 200, () => {
      readConfig(labId, name!);
      const text = requireString(markdown, "markdown");
      writeConfig(labId, name!, text, true);
      return { name: normalizeConfigName(name), report: matchConfig(loadLabSpec(labId), parseConfigMarkdown(text)) };
    });
  });

  app.delete("/:name", async (req, reply) => {
    const { labId, name } = req.params as Params;
    return handle(reply, labId, 200, () => {
      deleteConfig(labId, name!);
      return { deleted: true, name: normalizeConfigName(name) };
    });
  });
}
