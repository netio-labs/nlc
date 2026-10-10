import type { FastifyInstance } from "fastify";
import type { LabSpec } from "../types/index.ts";
import { getInstanceId } from "../db/index.ts";
import {
  consolePort,
  getErrorCode,
  isConsoleListening,
  loadLabSpec,
  onNodeStop,
  resetConsole,
  wipeContainerVolumes,
  startNode,
  stopNode,
  reconcileContainerLinks,
} from "../services/index.ts";

function findNode(spec: LabSpec, nodeId: string): LabSpec["nodes"][number] | null {
  return spec.nodes.find((n) => n.id === nodeId) ?? null;
}

const START_ERROR_STATUS: Record<string, number> = {
  LAB_NOT_LOADED: 409,
  INVALID_LAB_SPEC: 400,
  INTERFACE_NOT_FOUND: 400,
  IOULIVE86_NOT_FOUND: 500,
  IOULIVE86_START_FAILED: 500,
  // container nodes (podman + veth helper)
  CONTAINER_RUN_FAILED: 500,
  CONTAINER_NOT_FOUND: 500,
  CONTAINER_NOT_RUNNING: 500,
  VETH_ATTACH_FAILED: 500,
  VETH_PAIR_FAILED: 500,
  INVALID_INSTANCE_ID: 500,
};

function startErrorStatus(err: unknown): { code: string; status: number } | null {
  const code = getErrorCode(err);
  if (!code || !(code in START_ERROR_STATUS)) return null;
  return { code, status: START_ERROR_STATUS[code] };
}

export async function nodesRoutes(app: FastifyInstance) {
  app.post("/start", async (req, reply) => {
    const { labId } = req.params as { labId: string };
    const spec = loadLabSpec(labId);
    let changed = false;

    for (const node of spec.nodes) {
      const instanceId = getInstanceId(spec.lab.id, node.id);
      if (!instanceId) {
        return reply.status(409).send({
          ok: false,
          error: { code: "LAB_NOT_LOADED", message: "Lab not loaded. Call /load first." },
        });
      }
      const port = consolePort(instanceId);
      if (isConsoleListening(port)) {
        continue;
      }
      try {
        await startNode(spec.lab.id, node, spec);
      } catch (err) {
        const known = startErrorStatus(err);
        if (known) {
          return reply.status(known.status).send({
            ok: false,
            error: { code: known.code, message: (err as Error).message },
          });
        }
        throw err;
      }
      changed = true;
    }

    // Wire container<->container veth links now that containers are up.
    try {
      reconcileContainerLinks(spec.lab.id, spec);
    } catch (err) {
      const known = startErrorStatus(err);
      if (known) {
        return reply.status(known.status).send({ ok: false, error: { code: known.code, message: (err as Error).message } });
      }
      throw err;
    }

    return reply.send({
      ok: true,
      data: { started: spec.nodes.length },
      meta: { changed },
    });
  });

  app.post("/stop", async (req, reply) => {
    const { labId } = req.params as { labId: string };
    const spec = loadLabSpec(labId);
    let changed = false;

    for (const node of spec.nodes) {
      const instanceId = getInstanceId(spec.lab.id, node.id);
      if (!instanceId) {
        return reply.status(409).send({
          ok: false,
          error: { code: "LAB_NOT_LOADED", message: "Lab not loaded. Call /load first." },
        });
      }
      const port = consolePort(instanceId);
      const wasRunning = isConsoleListening(port);
      if (wasRunning) {
        stopNode(spec.lab.id, node);
        changed = true;
      }
      onNodeStop(spec.lab.id, node.id);
    }

    return reply.send({
      ok: true,
      data: { stopped: spec.nodes.length },
      meta: { changed },
    });
  });

  app.post("/:nodeId/start", async (req, reply) => {
    const { labId, nodeId } = req.params as { labId: string; nodeId: string };
    const spec = loadLabSpec(labId);
    const node = findNode(spec, nodeId);
    if (!node) {
      return reply.status(404).send({
        ok: false,
        error: { code: "NODE_NOT_FOUND", message: "Node not found" },
      });
    }

    const instanceId = getInstanceId(spec.lab.id, nodeId);
    if (!instanceId) {
      return reply.status(409).send({
        ok: false,
        error: { code: "LAB_NOT_LOADED", message: "Lab not loaded. Call /load first." },
      });
    }
    const port = consolePort(instanceId);
    if (isConsoleListening(port)) {
      return reply.send({
        ok: true,
        data: { status: "running" },
        meta: { changed: false },
      });
    }

    try {
      await startNode(spec.lab.id, node, spec);
    } catch (err) {
      const known = startErrorStatus(err);
      if (known) {
        return reply.status(known.status).send({
          ok: false,
          error: { code: known.code, message: (err as Error).message },
        });
      }
      throw err;
    }
    try {
      reconcileContainerLinks(spec.lab.id, spec);
    } catch (err) {
      const known = startErrorStatus(err);
      if (known) {
        return reply.status(known.status).send({ ok: false, error: { code: known.code, message: (err as Error).message } });
      }
      throw err;
    }
    return reply.send({
      ok: true,
      data: { status: "running" },
      meta: { changed: true },
    });
  });

  app.post("/:nodeId/stop", async (req, reply) => {
    const { labId, nodeId } = req.params as { labId: string; nodeId: string };
    const spec = loadLabSpec(labId);
    const node = findNode(spec, nodeId);
    if (!node) {
      return reply.status(404).send({
        ok: false,
        error: { code: "NODE_NOT_FOUND", message: "Node not found" },
      });
    }
    const instanceId = getInstanceId(spec.lab.id, nodeId);
    if (!instanceId) {
      return reply.status(409).send({
        ok: false,
        error: { code: "LAB_NOT_LOADED", message: "Lab not loaded. Call /load first." },
      });
    }
    const port = consolePort(instanceId);
    const wasRunning = isConsoleListening(port);
    if (wasRunning) {
      stopNode(spec.lab.id, node);
    }
    onNodeStop(spec.lab.id, nodeId);
    return reply.send({
      ok: true,
      data: { status: "stopped" },
      meta: { changed: wasRunning },
    });
  });

  app.post("/:nodeId/reset", async (req, reply) => {
    const { labId, nodeId } = req.params as { labId: string; nodeId: string };
    const spec = loadLabSpec(labId);
    if (!findNode(spec, nodeId)) {
      return reply.status(404).send({
        ok: false,
        error: { code: "NODE_NOT_FOUND", message: "Node not found" },
      });
    }

    let changed = false;
    try {
      changed = resetConsole(spec.lab.id, nodeId);
    } catch (err) {
      const code = getErrorCode(err);
      if (code === "LAB_NOT_LOADED") {
        return reply.status(409).send({
          ok: false,
          error: { code, message: "Lab not loaded. Call /load first." },
        });
      }
      throw err;
    }
    return reply.send({
      ok: true,
      data: { status: changed ? "reset" : "stopped" },
      meta: { changed },
    });
  });

  // Wipe Data (container nodes): drop the node's volumes so its next start is factory-fresh.
  app.post("/:nodeId/wipe", async (req, reply) => {
    const { labId, nodeId } = req.params as { labId: string; nodeId: string };
    const node = findNode(loadLabSpec(labId), nodeId);
    if (!node) {
      return reply.status(404).send({ ok: false, error: { code: "NODE_NOT_FOUND", message: "Node not found" } });
    }
    if (node.type !== "container") {
      return reply.status(400).send({ ok: false, error: { code: "NOT_A_CONTAINER", message: "Only container nodes have data to wipe." } });
    }
    if (!getInstanceId(labId, nodeId)) {
      return reply.status(409).send({ ok: false, error: { code: "LAB_NOT_LOADED", message: "Lab not loaded. Call /load first." } });
    }
    try {
      const volumes = wipeContainerVolumes(labId, nodeId);
      return reply.send({ ok: true, data: { volumes }, meta: { changed: volumes > 0 } });
    } catch (err) {
      if (getErrorCode(err) === "NODE_RUNNING") {
        return reply.status(409).send({ ok: false, error: { code: "NODE_RUNNING", message: (err as Error).message } });
      }
      throw err;
    }
  });

  app.get("/:nodeId", async (req, reply) => {
    const { labId, nodeId } = req.params as { labId: string; nodeId: string };
    const spec = loadLabSpec(labId);
    const node = findNode(spec, nodeId);
    if (!node) {
      return reply.status(404).send({
        ok: false,
        error: { code: "NODE_NOT_FOUND", message: "Node not found" },
      });
    }
    const instanceId = getInstanceId(spec.lab.id, nodeId);
    if (!instanceId) {
      return reply.status(409).send({
        ok: false,
        error: { code: "LAB_NOT_LOADED", message: "Lab not loaded. Call /load first." },
      });
    }
    const port = consolePort(instanceId);
    return reply.send({
      ok: true,
      data: {
        node: {
          id: node.id,
          name: node.name,
          instance_id: instanceId,
          console_port: port,
          status: isConsoleListening(port) ? "running" : "stopped",
        },
      },
    });
  });
}
