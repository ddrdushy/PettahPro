import type { FastifyPluginAsync } from "fastify";
import { sql } from "drizzle-orm";
import { withTenant } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";
import { requirePermission } from "../../lib/permissions.js";
import { recordAuditEvent } from "../../lib/audit.js";
import {
  putObject,
  getObjectStream,
  deleteObject,
} from "../../lib/object-storage.js";

/**
 * Tenant logo (M9 / gaps M9).
 *
 *   POST   /settings/logo   — multipart upload (PNG / JPEG / WebP, ≤2MB).
 *   GET    /settings/logo   — streams the bytes inline.
 *   DELETE /settings/logo   — clears the logo.
 *
 * Bytes live in the same MinIO bucket as document attachments, under a
 * deterministic key (`<tenant-id>/_branding/logo`). We overwrite in
 * place on re-upload — no UUID suffix — because the on-disk filename
 * doesn't matter for branding (metadata in `tenant_settings` carries
 * the content-type) and orphan cleanup is one fewer thing to think
 * about.
 *
 * SVG is intentionally NOT in the allow-list: SVG can carry inline
 * `<script>` and the byte stream lands in `<img src=…>` on a tenant
 * page, so a malicious upload becomes stored XSS. PNG / JPEG / WebP
 * cover every real branding need.
 */

const ALLOWED_CONTENT_TYPES = new Set<string>([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2 MB — generous for a brand mark.

function logoStorageKey(tenantId: string): string {
  return `${tenantId}/_branding/logo`;
}

export const tenantLogoRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /settings/logo — auth-only (members of the tenant). Streams the
  // bytes back inline so an <img src> can render without exposing the
  // raw S3/MinIO endpoint to the browser.
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const settings = await withTenant(ctx.tenantId, async (tx) => {
      const rows = (await tx.execute(sql`
        SELECT settings FROM tenant_settings WHERE tenant_id = current_tenant_id()
      `)) as unknown as Array<{ settings: Record<string, unknown> | null }>;
      return rows[0]?.settings ?? {};
    });

    const objectKey = (settings as Record<string, unknown>).logoObjectKey;
    const contentType = (settings as Record<string, unknown>).logoContentType;
    if (typeof objectKey !== "string" || typeof contentType !== "string") {
      return reply.status(404).send({
        error: { code: "NO_LOGO", message: "No logo configured for this tenant." },
      });
    }

    const obj = await getObjectStream(objectKey);
    if (!obj) {
      // Metadata says we have one, bytes are gone — log + 404 the caller
      // rather than 500. Likely a manual MinIO purge or a failed upload
      // that updated the row before the put completed.
      req.log.warn(
        { tenantId: ctx.tenantId, objectKey },
        "tenant logo metadata present but object missing",
      );
      return reply.status(404).send({
        error: { code: "OBJECT_MISSING", message: "Logo file missing from storage." },
      });
    }

    reply
      .type(obj.contentType ?? contentType)
      .header("Content-Disposition", `inline; filename="logo"`)
      // Browser-side cache for an hour; the web client appends ?v=<updatedAt>
      // for cache-busting on replace.
      .header("Cache-Control", "private, max-age=3600");
    if (obj.contentLength !== null) {
      reply.header("Content-Length", String(obj.contentLength));
    }
    return reply.send(obj.stream);
  });

  // POST /settings/logo — multipart upload. settings.manage gated.
  fastify.post("/", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "settings.manage");
    if (!ctx) return;

    let fileBuffer: Buffer | undefined;
    let contentType: string | undefined;

    try {
      const reqAny = req as unknown as {
        parts: () => AsyncIterable<
          | {
              type: "file";
              filename: string;
              mimetype: string;
              toBuffer: () => Promise<Buffer>;
            }
          | { type: "field"; fieldname: string; value: string }
        >;
      };
      for await (const part of reqAny.parts()) {
        if (part.type === "file") {
          if (fileBuffer) {
            return reply.status(400).send({
              error: { code: "TOO_MANY_FILES", message: "Upload one file." },
            });
          }
          fileBuffer = await part.toBuffer();
          contentType = part.mimetype;
        }
      }
    } catch (err) {
      const e = err as { code?: string; message?: string };
      if (e?.code === "FST_REQ_FILE_TOO_LARGE") {
        return reply.status(413).send({
          error: { code: "FILE_TOO_LARGE", message: "Logo must be 2 MB or smaller." },
        });
      }
      req.log.error({ err }, "logo multipart parse failed");
      return reply.status(400).send({
        error: {
          code: "MULTIPART_PARSE_FAILED",
          message: e?.message ?? "Couldn't read upload.",
        },
      });
    }

    if (!fileBuffer || !contentType) {
      return reply.status(400).send({
        error: { code: "MISSING_FILE", message: "No file in request." },
      });
    }
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
      return reply.status(415).send({
        error: {
          code: "UNSUPPORTED_CONTENT_TYPE",
          message: "Logo must be PNG, JPEG, or WebP.",
        },
      });
    }
    if (fileBuffer.length > MAX_LOGO_BYTES) {
      return reply.status(413).send({
        error: { code: "FILE_TOO_LARGE", message: "Logo must be 2 MB or smaller." },
      });
    }

    const objectKey = logoStorageKey(ctx.tenantId);
    try {
      await putObject(objectKey, fileBuffer, contentType);
    } catch (err) {
      req.log.error({ err, objectKey }, "logo putObject failed");
      return reply.status(503).send({
        error: {
          code: "STORAGE_UNAVAILABLE",
          message: "Couldn't reach the logo store. Try again in a moment.",
        },
      });
    }

    const now = new Date();
    const sizeBytes = fileBuffer.length;
    const persistedContentType = contentType;
    await withTenant(ctx.tenantId, async (tx) => {
      await tx.execute(sql`
        INSERT INTO tenant_settings (tenant_id, settings, updated_by_user_id)
        VALUES (
          current_tenant_id(),
          jsonb_build_object(
            'logoObjectKey', ${objectKey}::text,
            'logoContentType', ${persistedContentType}::text,
            'logoUpdatedAt', ${now.toISOString()}::text
          ),
          ${ctx.userId}::uuid
        )
        ON CONFLICT (tenant_id) DO UPDATE
          SET settings = tenant_settings.settings || EXCLUDED.settings,
              updated_at = now(),
              updated_by_user_id = EXCLUDED.updated_by_user_id
      `);

      await recordAuditEvent(tx, {
        kind: "tenant.logo_uploaded",
        summary: `Uploaded tenant logo (${persistedContentType}, ${sizeBytes} bytes)`,
        diff: { contentType: persistedContentType, sizeBytes },
        actorUserId: ctx.userId,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      });
    });

    return reply.send({
      logoContentType: persistedContentType,
      logoUpdatedAt: now.toISOString(),
      sizeBytes,
    });
  });

  // DELETE /settings/logo — remove from MinIO + clear the metadata.
  fastify.delete("/", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "settings.manage");
    if (!ctx) return;

    const objectKey = logoStorageKey(ctx.tenantId);

    // Best-effort delete — if the object is already gone, that's fine.
    // We still want the metadata cleared so the UI shows "no logo".
    try {
      await deleteObject(objectKey);
    } catch (err) {
      const e = err as { name?: string };
      if (e?.name !== "NoSuchKey") {
        req.log.warn({ err, objectKey }, "logo deleteObject failed; clearing metadata anyway");
      }
    }

    await withTenant(ctx.tenantId, async (tx) => {
      await tx.execute(sql`
        UPDATE tenant_settings
           SET settings = settings - 'logoObjectKey' - 'logoContentType' - 'logoUpdatedAt',
               updated_at = now(),
               updated_by_user_id = ${ctx.userId}::uuid
         WHERE tenant_id = current_tenant_id()
      `);

      await recordAuditEvent(tx, {
        kind: "tenant.logo_deleted",
        summary: "Deleted tenant logo",
        actorUserId: ctx.userId,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      });
    });

    return reply.send({ ok: true });
  });
};
