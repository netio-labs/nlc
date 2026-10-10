import type { FastifyInstance } from "fastify";
import { DEFAULT_USERNAME, updateUserPassword, verifyUserPassword } from "../db/index.ts";

export async function userRoutes(app: FastifyInstance) {
  app.post("/change-password", async (req, reply) => {
    const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };

    if (!currentPassword || !newPassword) {
      return reply.status(400).send({
        ok: false,
        error: { code: "INVALID_INPUT", message: "currentPassword and newPassword are required." },
      });
    }
    if (newPassword.length < 4) {
      return reply.status(400).send({
        ok: false,
        error: { code: "PASSWORD_TOO_SHORT", message: "New password must be at least 4 characters." },
      });
    }
    if (!verifyUserPassword(DEFAULT_USERNAME, currentPassword)) {
      return reply.status(401).send({
        ok: false,
        error: { code: "INVALID_PASSWORD", message: "Current password is incorrect." },
      });
    }

    updateUserPassword(DEFAULT_USERNAME, newPassword);
    return reply.send({ ok: true, data: { updated: true } });
  });
}
