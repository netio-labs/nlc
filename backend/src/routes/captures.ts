import type { FastifyInstance } from "fastify";
import { addPacketTap, getCapture, getErrorCode, listCaptures, loadLabSpec, removePacketTap, resetLabCaptures, startCapture, stopCapture } from "../services/index.ts";
import { createSharkdSession, destroySharkdSession, getSharkdFrameDetail, pollNewFrames, setSharkdFilter } from "../services/sharkd.ts";

export async function capturesRoutes(app: FastifyInstance) {
  app.get("/", async (req, reply) => {
    const { labId } = req.params as { labId: string };
    const { linkId } = req.query as { linkId?: string };
    const captures = listCaptures(labId, linkId);
    return reply.send({ ok: true, data: captures });
  });

  app.post("/", async (req, reply) => {
    const { labId } = req.params as { labId: string };
    const { linkId, encap } = req.body as { linkId: string; encap?: string };
    if (!linkId) {
      return reply.status(400).send({
        ok: false,
        error: { code: "INVALID_LINK_ID", message: "linkId is required" },
      });
    }

    const spec = loadLabSpec(labId);
    try {
      const result = await startCapture(spec, linkId, encap);
      return reply.send({
        ok: true,
        data: { captureId: result.captureId, linkId: result.linkId, dlt: result.dlt, captureUrl: result.captureUrl },
      });
    } catch (err) {
      const code = getErrorCode(err) ?? "CAPTURE_START_FAILED";
      const message = err instanceof Error ? err.message : "Failed to start capture";
      return reply.status(409).send({ ok: false, error: { code, message } });
    }
  });

  app.get("/:captureId", async (req, reply) => {
    const { labId, captureId } = req.params as { labId: string; captureId: string };
    const capture = getCapture(labId, Number(captureId));
    if (!capture) {
      return reply.status(404).send({ ok: false, error: { code: "CAPTURE_NOT_FOUND", message: "Capture not found" } });
    }
    return reply.send({ ok: true, data: capture });
  });

  app.get("/:captureId/stream", { websocket: true }, (socket, req) => {
    const { labId, captureId: captureIdStr } = req.params as { labId: string; captureId: string };
    const captureId = Number(captureIdStr);

    const capture = getCapture(labId, captureId);
    if (!capture) {
      socket.close(1011, "Capture not found");
      return;
    }

    createSharkdSession(
      captureId,
      capture.dlt,
      (tap) => addPacketTap(captureId, tap),
    );

    let pollTimer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      if (socket.readyState !== socket.OPEN) return;
      const frames = await pollNewFrames(captureId);
      for (const frame of frames) {
        socket.send(JSON.stringify({ type: "frame", data: frame }));
      }
      pollTimer = setTimeout(() => void poll(), 500);
    };

    pollTimer = setTimeout(() => void poll(), 200);

    socket.on("message", (data: Buffer) => {
      void (async () => {
        const msg = JSON.parse(data.toString()) as { type: string; frameNum?: number; expr?: string };
        if (msg.type === "frame_detail" && msg.frameNum) {
          const detail = await getSharkdFrameDetail(captureId, msg.frameNum);
          if (detail && socket.readyState === socket.OPEN) {
            socket.send(JSON.stringify({ type: "frame_detail", frameNum: msg.frameNum, ...detail }));
          }
        } else if (msg.type === "filter") {
          setSharkdFilter(captureId, msg.expr ?? "");
          socket.send(JSON.stringify({ type: "clear" }));
        }
      })();
    });

    socket.on("close", () => {
      clearTimeout(pollTimer);
      destroySharkdSession(captureId, (tap) => removePacketTap(captureId, tap));
    });
  });

  app.post("/:captureId/stop", async (req, reply) => {
    const { labId, captureId } = req.params as { labId: string; captureId: string };
    const stopped = stopCapture(labId, Number(captureId));
    if (!stopped) {
      return reply.status(404).send({ ok: false, error: { code: "CAPTURE_NOT_FOUND", message: "Capture not found" } });
    }
    return reply.send({ ok: true, data: { stopped: true } });
  });

  app.post("/cleanup", async (req, reply) => {
    const { labId } = req.params as { labId: string };
    resetLabCaptures(labId);
    return reply.send({ ok: true, data: { cleaned: true } });
  });
}
