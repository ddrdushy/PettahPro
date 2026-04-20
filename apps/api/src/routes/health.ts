import type { FastifyPluginAsync } from "fastify";
import { sql } from "drizzle-orm";
import { db } from "@pettahpro/db";

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", async () => ({
    status: "ok",
    service: "pettahpro-api",
    version: "0.1.0",
    timestamp: new Date().toISOString(),
  }));

  fastify.get("/ready", async (_req, reply) => {
    try {
      await db.execute(sql`SELECT 1`);
      return { status: "ready", db: "up" };
    } catch (err) {
      reply.status(503);
      return { status: "not-ready", db: "down", error: (err as Error).message };
    }
  });
};
