/*
 * Host-level information (physical interfaces for ioulive86 bridging) and the
 * web SSH terminal gateway.
 */
import net from "node:net";
import type { FastifyInstance } from "fastify";
import {
  acquireShellSession,
  getErrorCode,
  isValidSessionId,
  killShellSession,
  listHostInterfaces,
  releaseShellSession,
  validateShellTarget,
} from "../services/index.ts";

export async function hostRoutes(app: FastifyInstance) {
  app.get("/interfaces", async (_req, reply) => {
    return reply.send({ ok: true, data: { interfaces: listHostInterfaces() } });
  });

  // Web SSH terminal: proxy raw bytes between the browser and a system `ssh`
  // client running on a pty. Auth is handled by the host's sshd via the ssh
  // client's own password prompt; NLC never sees the credentials.
  app.get("/shell", { websocket: true }, (socket, req) => {
    const q = req.query as { user?: string; session?: string };
    const user = (q.user ?? "").trim();
    // Host is fixed to localhost on purpose: this terminal exists to shell into
    // the backend host itself, not to let the backend act as an SSH jump box to
    // arbitrary machines. Never take the target host from the client.
    const host = "localhost";
    const sessionId = (q.session ?? "").trim();

    const invalid = validateShellTarget(user, host);
    if (invalid) {
      socket.close(1008, invalid);
      return;
    }
    if (!isValidSessionId(sessionId)) {
      socket.close(1008, "invalid session id");
      return;
    }

    void (async () => {
      let port: number;
      try {
        ({ port } = await acquireShellSession(sessionId, user, host));
      } catch (err) {
        app.log.warn({ err, user, host }, "host shell acquire failed");
        socket.close(getErrorCode(err) === "SHELL_BUSY" ? 1008 : 1011,
          getErrorCode(err) === "SHELL_BUSY" ? "session busy" : "shell start failed");
        return;
      }
      // The socket may have closed while ssh was starting up.
      if (socket.readyState !== socket.OPEN) {
        releaseShellSession(sessionId);
        return;
      }

      const tcp = net.createConnection({ host: "127.0.0.1", port });
      let done = false;
      // Client left (navigated away): keep ssh alive for a later re-attach.
      const detach = () => {
        if (done) return;
        done = true;
        tcp.destroy();
        releaseShellSession(sessionId);
      };
      // ssh itself ended (exit / auth fail): tear the session down for good.
      const terminate = () => {
        if (done) return;
        done = true;
        tcp.destroy();
        killShellSession(sessionId);
      };

      tcp.on("data", (data) => {
        if (socket.readyState === socket.OPEN) socket.send(data);
      });
      tcp.on("close", () => {
        socket.close();
        terminate();
      });
      tcp.on("error", (err) => {
        app.log.warn({ err, user, host }, "host shell TCP error");
        socket.close(1011, "TCP error");
        terminate();
      });

      socket.on("message", (data: Buffer) => {
        if (!tcp.destroyed) tcp.write(data);
      });
      socket.on("close", detach);
    })();
  });
}
