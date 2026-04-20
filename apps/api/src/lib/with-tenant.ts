import type { FastifyRequest, FastifyReply } from "fastify";

/**
 * Guards a route — 401 if no authenticated session, otherwise returns
 * the request's tenantId and userId as non-null.
 */
export function requireAuth(req: FastifyRequest, reply: FastifyReply): {
  tenantId: string;
  userId: string;
} | null {
  if (!req.tenantId || !req.userId) {
    reply.status(401).send({ error: { code: "UNAUTHENTICATED" } });
    return null;
  }
  return { tenantId: req.tenantId, userId: req.userId };
}
