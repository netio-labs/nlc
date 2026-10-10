import type { FastifyInstance } from "fastify";
import { verifyUserPassword } from "../db/index.ts";

export async function authRoutes(app: FastifyInstance) {
  app.post("/login", async (req, reply) => {
    const { username, password } = req.body as { username?: string; password?: string };

    if (!username || !password || !verifyUserPassword(username, password)) {
      return reply.code(401).send({ error: { message: "Invalid credentials" } });
    }

    const token = await reply.jwtSign({ sub: username }, { expiresIn: "30d" });
    return reply.send({ ok: true, data: { token } });
  });
}
