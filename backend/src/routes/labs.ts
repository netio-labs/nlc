/*
 * Route handlers for labs
 */

import type { FastifyInstance } from "fastify";
import {
  createLab,
  deleteLab as deleteLabFromDb,
  ensureLabInstanceIds,
  getAllLabs,
  getInstanceId,
  getLabById,
  listAllAllocatedInstances,
  listLabInstanceIds,
  releaseLabInstances,
  updateLab,
} from "../db/index.ts";
import {
  buildNetmapLines,
  consolePort,
  copyLabConfigs,
  deleteLabSpecFile,
  getErrorCode,
  hasLabSpecFile,
  isConsoleListening,
  loadLabSpec,
  prepareLabRuntimeDir,
  prepareNodeRuntimeDirs,
  removeLabConfigs,
  removeLabRuntimeDir,
  removeLabVolumes,
  resetLabCaptures,
  saveLabSpecFile,
  stopByConsolePort,
  stopNode,
  validateLabSpecData,
  writeNetmap,
} from "../services/index.ts";

type LabsListQuery = {
  limit?: string;
  offset?: string;
  view?: string;
};

export async function labsRoutes(app: FastifyInstance) {
  app.get("/", async (req, reply) => {
    const query = (req.query ?? {}) as LabsListQuery;
    const limit = Number(query.limit ?? 10);
    const offset = Number(query.offset ?? 0);
    const view = query.view ?? "update";
    if (Number.isNaN(limit) || limit < 0 || Number.isNaN(offset) || offset < 0) {
      return reply.status(400).send({
        ok: false,
        error: { code: "INVALID_QUERY", message: "Query params limit and offset must be non-negative numbers." },
      });
    }

    const { labs, total } = getAllLabs(limit, offset, view);
    const items = labs.map((lab) => ({
      id: lab.id,
      name: lab.name,
      description: lab.description ?? undefined,
      createdAt: Date.parse(lab.createdAt),
      updatedAt: Date.parse(lab.updatedAt),
    }));
    return reply.send({ ok: true, data: { labs: items, total } });
  });

  app.post("/", async (req, reply) => {
    const payload = req.body as unknown;
    const result = validateLabSpecData(payload);
    if (!result.ok) {
      return reply.status(400).send({
        ok: false,
        error: { code: "INVALID_LAB_SPEC", message: result.error },
      });
    }

    const newLabId = result.data.lab.id;
    if (getLabById(newLabId) || hasLabSpecFile(newLabId)) {
      return reply.status(409).send({
        ok: false,
        error: { code: "LAB_ALREADY_EXISTS", message: `Lab ${newLabId} already exists.` },
      });
    }

    const filePath = saveLabSpecFile(newLabId, payload);
    createLab({
      id: newLabId,
      name: result.data.lab.name,
      description: result.data.lab.description,
    });

    return reply.status(201).send({
      ok: true,
      data: { created: true, labId: newLabId, path: filePath },
    });
  });

  app.get("/active", async (_req, reply) => {
    // Group all allocated instances by labId, then probe each console port.
    const allInstances = listAllAllocatedInstances();
    const byLab = new Map<string, number[]>();
    for (const { labId, instanceId } of allInstances) {
      const list = byLab.get(labId) ?? [];
      list.push(instanceId);
      byLab.set(labId, list);
    }

    const result = [];
    for (const [labId, instanceIds] of byLab) {
      const lab = getLabById(labId);
      if (!lab) continue;
      const totalNodes = instanceIds.length;
      const runningNodes = instanceIds.filter((id) => isConsoleListening(consolePort(id))).length;
      if (runningNodes === 0) continue;
      result.push({
        id: lab.id,
        name: lab.name,
        description: lab.description ?? undefined,
        updatedAt: Date.parse(lab.updatedAt),
        runningNodes,
        totalNodes,
      });
    }

    return reply.send({ ok: true, data: { labs: result } });
  });

  app.get("/:labId", async (req, reply) => {
    const { labId } = req.params as { labId: string };
    const spec = loadLabSpec(labId);

    const nodes = spec.nodes.map((node) => {
      const instanceId = getInstanceId(spec.lab.id, node.id);
      const port = instanceId ? consolePort(instanceId) : null;
      return {
        id: node.id,
        name: node.name,
        instance_id: instanceId ?? null,
        console_port: port,
        status: port && isConsoleListening(port) ? "running" : "stopped",
      };
    });

    return reply.send({ ok: true, data: { lab: spec.lab, nodes } });
  });

  app.get("/:labId/spec", async (req, reply) => {
    const { labId } = req.params as { labId: string };
    const spec = loadLabSpec(labId);
    return reply.send({ ok: true, data: { spec } });
  });

  app.put("/:labId", async (req, reply) => {
    const { labId } = req.params as { labId: string };
    const payload = req.body as unknown;
    const result = validateLabSpecData(payload);
    if (!result.ok) {
      return reply.status(400).send({
        ok: false,
        error: { code: "INVALID_LAB_SPEC", message: result.error },
      });
    }
    if (result.data.lab.id !== labId) {
      return reply.status(400).send({
        ok: false,
        error: { code: "LAB_ID_MISMATCH", message: `Body lab.id (${result.data.lab.id}) must match path labId (${labId}).` },
      });
    }

    if (!getLabById(labId) || !hasLabSpecFile(labId)) {
      return reply.status(404).send({
        ok: false,
        error: { code: "LAB_NOT_FOUND", message: `Lab ${labId} not found.` },
      });
    }

    const filePath = saveLabSpecFile(labId, payload);
    updateLab({
      id: labId,
      name: result.data.lab.name,
      description: result.data.lab.description,
    });

    return reply.send({
      ok: true,
      data: {
        updated: true,
        labId,
        path: filePath,
        message: "Lab spec updated. Please call /v1/labs/:labId/load again to apply topology changes.",
      },
    });
  });

  app.delete("/:labId", async (req, reply) => {
    const { labId } = req.params as { labId: string };
    const allocated = listLabInstanceIds(labId).length;
    if (allocated > 0) {
      return reply.status(409).send({
        ok: false,
        error: { code: "LAB_LOADED", message: "Lab is still loaded. Please unload in viewer first." },
      });
    }

    if (!getLabById(labId) || !hasLabSpecFile(labId)) {
      return reply.status(404).send({
        ok: false,
        error: { code: "LAB_NOT_FOUND", message: `Lab ${labId} not found.` },
      });
    }

    const filePath = deleteLabSpecFile(labId);
    deleteLabFromDb(labId);
    removeLabConfigs(labId);
    return reply.send({
      ok: true,
      data: { deleted: true, labId, path: filePath },
    });
  });

  app.post("/:labId/duplicate", async (req, reply) => {
    const { labId } = req.params as { labId: string };

    if (!getLabById(labId) || !hasLabSpecFile(labId)) {
      return reply.status(404).send({
        ok: false,
        error: { code: "LAB_NOT_FOUND", message: `Lab ${labId} not found.` },
      });
    }

    const original = loadLabSpec(labId);

    // Build UUID remapping tables
    const newLabId = crypto.randomUUID();
    const nodeIdMap = new Map<string, string>(
      original.nodes.map((n) => [n.id, crypto.randomUUID()]),
    );
    const linkIdMap = new Map<string, string>(
      (original.links ?? []).map((l) => [l.id, crypto.randomUUID()]),
    );

    // Build duplicated spec
    const duped = {
      ...original,
      lab: {
        ...original.lab,
        id: newLabId,
        name: `${original.lab.name} duplicated`,
      },
      nodes: original.nodes.map((n) => ({ ...n, id: nodeIdMap.get(n.id)! })),
      links: (original.links ?? []).map((l) => ({
        ...l,
        id: linkIdMap.get(l.id)!,
        source: nodeIdMap.get(l.source) ?? l.source,
        target: nodeIdMap.get(l.target) ?? l.target,
      })),
      ...(original.ui
        ? {
            ui: {
              ...original.ui,
              nodes: Object.fromEntries(
                Object.entries(original.ui.nodes ?? {}).map(([oldId, pos]) => [
                  nodeIdMap.get(oldId) ?? oldId,
                  pos,
                ]),
              ),
              edges: Object.fromEntries(
                Object.entries(original.ui.edges ?? {}).map(([oldId, data]) => [
                  linkIdMap.get(oldId) ?? oldId,
                  data,
                ]),
              ),
            },
          }
        : {}),
    };

    const filePath = saveLabSpecFile(newLabId, duped);
    createLab({
      id: newLabId,
      name: duped.lab.name,
      description: duped.lab.description,
    });
    // Device names are unchanged, so the saved configurations apply to the copy as-is.
    copyLabConfigs(labId, newLabId);

    return reply.status(201).send({
      ok: true,
      data: { duplicated: true, labId: newLabId, path: filePath },
    });
  });

  app.post("/import", async (req, reply) => {
    const payload = req.body as unknown;
    const result = validateLabSpecData(payload);
    if (!result.ok) {
      return reply.status(400).send({
        ok: false,
        error: { code: "INVALID_LAB_SPEC", message: result.error },
      });
    }

    const original = result.data;

    // Build UUID remapping tables
    const newLabId = crypto.randomUUID();
    const nodeIdMap = new Map<string, string>(
      original.nodes.map((n) => [n.id, crypto.randomUUID()]),
    );
    const linkIdMap = new Map<string, string>(
      (original.links ?? []).map((l) => [l.id, crypto.randomUUID()]),
    );

    // Build imported spec, keeping the original name/description
    const imported = {
      ...original,
      lab: {
        ...original.lab,
        id: newLabId,
      },
      nodes: original.nodes.map((n) => ({ ...n, id: nodeIdMap.get(n.id)! })),
      links: (original.links ?? []).map((l) => ({
        ...l,
        id: linkIdMap.get(l.id)!,
        source: nodeIdMap.get(l.source) ?? l.source,
        target: nodeIdMap.get(l.target) ?? l.target,
      })),
      ...(original.ui
        ? {
            ui: {
              ...original.ui,
              nodes: Object.fromEntries(
                Object.entries(original.ui.nodes ?? {}).map(([oldId, pos]) => [
                  nodeIdMap.get(oldId) ?? oldId,
                  pos,
                ]),
              ),
              edges: Object.fromEntries(
                Object.entries(original.ui.edges ?? {}).map(([oldId, data]) => [
                  linkIdMap.get(oldId) ?? oldId,
                  data,
                ]),
              ),
            },
          }
        : {}),
    };

    const filePath = saveLabSpecFile(newLabId, imported);
    createLab({
      id: newLabId,
      name: imported.lab.name,
      description: imported.lab.description,
    });

    return reply.status(201).send({
      ok: true,
      data: { imported: true, labId: newLabId, path: filePath },
    });
  });

  app.post("/:labId/load", async (req, reply) => {
    const { labId } = req.params as { labId: string };
    const spec = loadLabSpec(labId);

    resetLabCaptures(spec.lab.id);
    let instanceMap: Map<string, number>;
    try {
      instanceMap = ensureLabInstanceIds(
        spec.lab.id,
        spec.nodes.map((node) => node.id),
      );
    } catch (err) {
      const code = getErrorCode(err);
      if (code === "NO_FREE_INSTANCE_ID") {
        return reply.status(409).send({
          ok: false,
          error: { code, message: "No available IOU instance IDs." },
        });
      }
      throw err;
    }
    prepareLabRuntimeDir(spec.lab.id);
    prepareNodeRuntimeDirs(
      spec.lab.id,
      spec.nodes.map((node) => node.id),
    );
    const lines = buildNetmapLines(spec, instanceMap);
    writeNetmap(spec.lab.id, lines);

    return reply.send({ ok: true, data: { loaded: true } });
  });

  app.post("/:labId/unload", async (req, reply) => {
    const { labId } = req.params as { labId: string };

    // Stop all capture sessions for this lab first.
    resetLabCaptures(labId);

    // Stop every node via stopNode so containers are removed and veths detached,
    // not just console wrappers killed.
    let stopped = 0;
    try {
      const spec = loadLabSpec(labId);
      for (const node of spec.nodes) {
        const instanceId = getInstanceId(labId, node.id);
        if (instanceId == null) continue;
        const wasRunning = isConsoleListening(consolePort(instanceId));
        stopNode(labId, node);
        if (wasRunning) stopped += 1;
      }
    } catch {
      // spec unavailable — fall back to stopping by console port
      for (const instanceId of listLabInstanceIds(labId)) {
        const port = consolePort(instanceId);
        if (isConsoleListening(port)) {
          stopByConsolePort(port);
          stopped += 1;
        }
      }
    }

    removeLabVolumes(labId); // per-node container volumes, like nvram, go with the runtime state
    const released = releaseLabInstances(labId);
    const runtime = removeLabRuntimeDir(labId);

    return reply.send({
      ok: true,
      data: {
        unloaded: true,
        capturesCleaned: true,
        runtimeRemoved: runtime.removed,
        runtimePath: runtime.path,
        releasedInstanceIds: released,
        stoppedNodes: stopped,
      },
    });
  });
}
