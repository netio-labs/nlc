import net from "net";
import type { FastifyInstance } from "fastify";
import { getInstanceId } from "../db/index.ts";
import { consolePort } from "../services/index.ts";

export async function consoleRoutes(app: FastifyInstance) {
  app.get("/:nodeId/console", { websocket: true }, (socket, req) => {
    const { labId, nodeId } = req.params as { labId: string; nodeId: string };

    const instanceId = getInstanceId(labId, nodeId);
    if (!instanceId) {
      socket.close(1011, "Lab not loaded");
      return;
    }

    const port = consolePort(instanceId);
    const tcp = net.createConnection({ host: "localhost", port });

    tcp.on("data", (data) => {
      if (socket.readyState === socket.OPEN) socket.send(data);
    });
    tcp.on("close", () => socket.close());
    tcp.on("error", (err) => {
      app.log.warn({ err, labId, nodeId }, "console TCP error");
      socket.close(1011, "TCP error");
    });

    socket.on("message", (data: Buffer) => {
      if (!tcp.destroyed) tcp.write(data);
    });
    socket.on("close", () => tcp.destroy());
  });
}
