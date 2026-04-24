import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Request-scoped impersonation context (#57 / gap L1 v1).
 *
 * The identity plugin's onRequest hook populates this from the tenant
 * session blob when the session is stamped as an impersonation. Every
 * audit write, via lib/audit.ts#recordAuditEvent, reads it back so the
 * platform actor gets stamped alongside the tenant actor on every row
 * written during the session — no call-site changes at the dozens of
 * existing audit writers.
 *
 * Why AsyncLocalStorage vs. threading an explicit `impersonator`
 * parameter through every domain function:
 *   - Dozens of audit writers. Adding an arg everywhere bloats the PR
 *     for zero runtime win.
 *   - Node's ALS is fast enough (a few ns per hop) and propagates
 *     cleanly across await boundaries inside a request lifecycle.
 *   - The invariant we actually care about is "every audit_events
 *     INSERT during an impersonation request gets stamped" —
 *     centralising the read in recordAuditEvent gets that guarantee
 *     without relying on every caller to remember.
 *
 * The ALS store is set exactly once per request (onRequest hook) and
 * carries null for ordinary tenant sessions. Reads outside a request
 * context (worker jobs, cron) return null, which is correct — those
 * aren't impersonations.
 */

export interface ImpersonationContext {
  platformUserId: string;
  platformUserEmail: string;
}

const als = new AsyncLocalStorage<ImpersonationContext | null>();

/**
 * Run `fn` with the given impersonation context attached to the async
 * chain. Used for synchronous scopes (tests, workers) where a wrapping
 * callback makes sense.
 */
export function runWithImpersonation<T>(
  ctx: ImpersonationContext | null,
  fn: () => T,
): T {
  return als.run(ctx, fn);
}

/**
 * Attach the impersonation context to the CURRENT async resource and
 * all its descendants. Used by Fastify's onRequest hook — Fastify's
 * request pipeline already exists as an async chain rooted at the
 * connection event, so a wrapping callback won't work. enterWith
 * "sets" the store for the current chain going forward.
 *
 * Each Fastify request gets its own root async resource (connection
 * event handler), so one request's enterWith cannot bleed into
 * another's. AsyncLocalStorage guarantees this propagation model.
 */
export function enterImpersonation(ctx: ImpersonationContext | null): void {
  als.enterWith(ctx);
}

/**
 * Read the current impersonation context. Returns null when there's
 * no context (ordinary tenant request, or any call outside a request
 * lifecycle — workers, cron, CLI scripts).
 */
export function getImpersonationContext(): ImpersonationContext | null {
  return als.getStore() ?? null;
}
