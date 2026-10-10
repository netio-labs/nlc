import Fastify from "fastify";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import { CONFIG } from "./config.ts";
import { authRoutes } from "./routes/auth.ts";
import { userRoutes } from "./routes/user.ts";
import { labsRoutes } from "./routes/labs.ts";
import { nodesRoutes } from "./routes/nodes.ts";
import { capturesRoutes } from "./routes/captures.ts";
import { configsRoutes } from "./routes/configs.ts";
import { containerImageRoutes, iouImageRoutes } from "./routes/images.ts";
import { consoleRoutes } from "./routes/console.ts";
import { hostRoutes } from "./routes/host.ts";
import { rollbackStaleCaptureProxies } from "./services/index.ts";

const app = Fastify({
  logger: CONFIG.enableLog ? {
    base: null,
    timestamp: () => `,"time":"${new Date().toLocaleString("zh-CN", { hour12: false })}"`,
  } : false,
});

async function main() {
  try {
    await app.register(jwt, { secret: CONFIG.auth.secret });
    // IOU images can be 100s of MB — without an explicit fileSize limit,
    // @fastify/multipart falls back to Fastify's default bodyLimit (1 MiB),
    // silently truncating larger uploads instead of rejecting them.
    await app.register(multipart, { limits: { files: 1, fileSize: 400 * 1024 * 1024 } });
    await app.register(websocket);
    await app.register(authRoutes, { prefix: "/v1/auth" });

    app.addHook("preHandler", async (request, reply) => {
      if (request.url.startsWith("/v1/auth/")) return;

      let token: string | undefined;

      const authHeader = request.headers.authorization;
      if (authHeader?.startsWith("Bearer ")) {
        token = authHeader.slice(7);
      }

      if (!token) {
        const cookieHeader = request.headers.cookie ?? "";
        const match = /(?:^|;\s*)nlc-token=([^;]+)/.exec(cookieHeader);
        if (match) token = decodeURIComponent(match[1]);
      }

      if (!token) {
        return reply.code(401).send({ error: { message: "Unauthorized" } });
      }

      try {
        app.jwt.verify(token);
      } catch {
        return reply.code(401).send({ error: { message: "Invalid token" } });
      }
    });

    await app.register(userRoutes, { prefix: "/v1/user" });
    await app.register(labsRoutes, { prefix: "/v1/labs" });
    await app.register(nodesRoutes, { prefix: "/v1/labs/:labId/nodes" });
    await app.register(capturesRoutes, { prefix: "/v1/labs/:labId/captures" });
    await app.register(configsRoutes, { prefix: "/v1/labs/:labId/configs" });
    await app.register(iouImageRoutes, { prefix: "/v1/image/iou" });
    await app.register(containerImageRoutes, { prefix: "/v1/image/container" });
    await app.register(consoleRoutes, { prefix: "/v1/labs/:labId/nodes" });
    await app.register(hostRoutes, { prefix: "/v1/host" });

    const rollback = rollbackStaleCaptureProxies();
    app.log.info({ restored: rollback.restored, skipped: rollback.skipped }, "capture proxy rollback completed");
    await app.listen({ host: CONFIG.host, port: CONFIG.port });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
