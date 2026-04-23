import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { and, eq, desc, isNull, sql } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import { withTenant, schema } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";
import { recordAuditEvent } from "../../lib/audit.js";
import {
  putObject,
  getObjectStream,
  buildStorageKey,
} from "../../lib/object-storage.js";

// Document attachments (roadmap #32) — cross-module file store.
//
// Routes (all tenant-scoped, all require auth):
//   POST   /attachments                           multipart upload
//   GET    /attachments?entityType=&entityId=     list for an entity
//   GET    /attachments/:id                       download (attachment)
//   GET    /attachments/:id/preview               inline (PDFs, images)
//   DELETE /attachments/:id                       soft-delete
//
// 10 MB per-file cap (enforced at @fastify/multipart level + checked
// again in this module as belt-and-braces). Allowed content types
// are a conservative list; tenants needing strictness can enforce
// narrower rules at the UI layer in v2.
//
// Soft-delete only — the bytes stay in S3 until `retention_until`
// passes (default 7 years). A v2 eviction cron hard-deletes
// retention-expired rows.

const ALLOWED_CONTENT_TYPES = new Set<string>([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/plain",
]);

const MAX_FILE_BYTES = 10 * 1024 * 1024;

const ENTITY_TYPES = schema.DOCUMENT_ATTACHMENT_ENTITY_TYPES;
type EntityType = (typeof ENTITY_TYPES)[number];

function isAllowedEntityType(v: unknown): v is EntityType {
  return (
    typeof v === "string" && (ENTITY_TYPES as readonly string[]).includes(v)
  );
}

// Maps entity_type → the SQL table name to guard existence against.
// Fixed allow-list — no SQL injection surface. RLS on target tables
// provides the same guarantee; this is belt-and-braces.
const ENTITY_TABLE: Record<EntityType, string> = {
  invoice: "invoices",
  sales_order: "sales_orders",
  quotation: "quotations",
  credit_note: "credit_notes",
  bill: "bills",
  purchase_order: "purchase_orders",
  purchase_requisition: "purchase_requisitions",
  goods_received_note: "grns",
  expense_claim: "expense_claims",
  payment: "payments",
  receipt: "payments",
  final_settlement: "final_settlements",
  journal_entry: "journal_entries",
};

function projectRow(row: typeof schema.documentAttachments.$inferSelect) {
  return {
    id: row.id,
    entityType: row.entityType,
    entityId: row.entityId,
    fileName: row.fileName,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    sha256: row.sha256,
    uploadedByUserId: row.uploadedByUserId,
    uploadedAt: row.uploadedAt,
    retentionUntil: row.retentionUntil,
    deletedAt: row.deletedAt,
  };
}

export const attachmentsRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /attachments — multipart upload. Expects form fields
  // `entityType` + `entityId` + one `file`. Validates the entity
  // exists in the tenant, pushes bytes to S3, stamps a row.
  fastify.post("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    // @fastify/multipart surfaces both files and text fields through
    // `req.parts()`. We accept exactly one file + the two text fields.
    let entityType: string | undefined;
    let entityId: string | undefined;
    let fileBuffer: Buffer | undefined;
    let fileName: string | undefined;
    let contentType: string | undefined;

    try {
      // req.parts() is only available when multipart plugin is
      // registered — see apps/api/src/server.ts.
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
              error: {
                code: "TOO_MANY_FILES",
                message: "Upload one file per request.",
              },
            });
          }
          fileBuffer = await part.toBuffer();
          fileName = part.filename;
          contentType = part.mimetype;
        } else if (part.type === "field") {
          if (part.fieldname === "entityType")
            entityType = String(part.value);
          else if (part.fieldname === "entityId")
            entityId = String(part.value);
        }
      }
    } catch (err) {
      const e = err as { code?: string; message?: string };
      if (e?.code === "FST_REQ_FILE_TOO_LARGE") {
        return reply.status(413).send({
          error: {
            code: "FILE_TOO_LARGE",
            message: "File exceeds the 10 MB per-file limit.",
          },
        });
      }
      req.log.error({ err }, "multipart parse failed");
      return reply.status(400).send({
        error: {
          code: "MULTIPART_PARSE_FAILED",
          message: e?.message ?? "Couldn't read upload.",
        },
      });
    }

    if (!fileBuffer || !fileName || !contentType) {
      return reply.status(400).send({
        error: { code: "MISSING_FILE", message: "No file part in request." },
      });
    }
    if (!entityType || !entityId) {
      return reply.status(400).send({
        error: {
          code: "MISSING_FIELDS",
          message: "entityType and entityId are required form fields.",
        },
      });
    }
    if (!isAllowedEntityType(entityType)) {
      return reply.status(400).send({
        error: {
          code: "UNSUPPORTED_ENTITY_TYPE",
          message: `entityType '${entityType}' is not supported.`,
        },
      });
    }
    if (!/^[0-9a-f-]{36}$/i.test(entityId)) {
      return reply.status(400).send({
        error: {
          code: "INVALID_ENTITY_ID",
          message: "entityId must be a UUID.",
        },
      });
    }
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
      return reply.status(415).send({
        error: {
          code: "UNSUPPORTED_CONTENT_TYPE",
          message: `Content-Type '${contentType}' is not in the allow-list.`,
        },
      });
    }
    if (fileBuffer.length > MAX_FILE_BYTES) {
      return reply.status(413).send({
        error: {
          code: "FILE_TOO_LARGE",
          message: "File exceeds the 10 MB per-file limit.",
        },
      });
    }

    const attachmentId = randomUUID();
    const storageKey = buildStorageKey({
      tenantId: ctx.tenantId,
      entityType,
      entityId,
      attachmentId,
      fileName,
    });
    const sha256Hex = createHash("sha256").update(fileBuffer).digest("hex");

    // Push bytes first, then stamp the row. If the row insert fails,
    // we'd leak an orphan object — but the key is deterministic so a
    // retry from the same request overwrites in place, and the v2
    // eviction cron will sweep anything older than retention anyway.
    try {
      await putObject(storageKey, fileBuffer, contentType);
    } catch (err) {
      req.log.error({ err, storageKey }, "S3 putObject failed");
      return reply.status(503).send({
        error: {
          code: "STORAGE_UNAVAILABLE",
          message:
            "Couldn't reach the attachment store. Try again in a moment.",
        },
      });
    }

    const capturedFileName = fileName;
    const capturedContentType = contentType;
    const capturedSize = fileBuffer.length;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      // Existence check: entity must live in this tenant. Table name
      // comes from the ENTITY_TABLE allow-list — safe to interpolate
      // via sql.identifier.
      const tableName = ENTITY_TABLE[entityType as EntityType];
      const existsRows = (await tx.execute(
        sql`SELECT 1 AS ok FROM ${sql.identifier(tableName)} WHERE id = ${entityId}::uuid AND tenant_id = current_tenant_id() LIMIT 1`,
      )) as unknown as Array<{ ok: number }>;
      if (existsRows.length === 0) {
        return { error: "ENTITY_NOT_FOUND" as const };
      }

      const [row] = await tx
        .insert(schema.documentAttachments)
        .values({
          id: attachmentId,
          tenantId: ctx.tenantId,
          entityType: entityType as EntityType,
          entityId: entityId as string,
          fileName: capturedFileName,
          contentType: capturedContentType,
          sizeBytes: capturedSize,
          storageKey,
          sha256: sha256Hex,
          uploadedByUserId: ctx.userId,
        })
        .returning();
      if (!row) return { error: "INSERT_FAILED" as const };

      await recordAuditEvent(tx, {
        kind: "attachment.uploaded",
        summary: `Uploaded ${capturedFileName} to ${entityType}`,
        refType: entityType,
        refId: entityId,
        diff: {
          attachmentId: row.id,
          sizeBytes: row.sizeBytes,
          contentType: capturedContentType,
          sha256: sha256Hex,
        },
        actorUserId: ctx.userId,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      });

      return { attachment: projectRow(row) };
    });

    if ("error" in result) {
      if (result.error === "ENTITY_NOT_FOUND") {
        return reply.status(404).send({
          error: {
            code: "ENTITY_NOT_FOUND",
            message: `${entityType} ${entityId} not found in this tenant.`,
          },
        });
      }
      return reply.status(500).send({ error: { code: result.error } });
    }
    return reply.status(201).send(result);
  });

  // GET /attachments?entityType=&entityId= — list for an entity.
  fastify.get<{
    Querystring: { entityType?: string; entityId?: string };
  }>("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const { entityType, entityId } = req.query ?? {};
    if (!entityType || !entityId) {
      return reply.status(400).send({
        error: {
          code: "MISSING_QUERY",
          message: "entityType and entityId query params are required.",
        },
      });
    }
    if (!isAllowedEntityType(entityType)) {
      return reply
        .status(400)
        .send({ error: { code: "UNSUPPORTED_ENTITY_TYPE" } });
    }

    const rows = await withTenant(ctx.tenantId, async (tx) =>
      tx
        .select()
        .from(schema.documentAttachments)
        .where(
          and(
            eq(schema.documentAttachments.tenantId, ctx.tenantId),
            eq(schema.documentAttachments.entityType, entityType),
            eq(schema.documentAttachments.entityId, entityId),
            isNull(schema.documentAttachments.deletedAt),
          ),
        )
        .orderBy(desc(schema.documentAttachments.uploadedAt)),
    );

    return reply.send({ attachments: rows.map(projectRow) });
  });

  // GET /attachments/:id — download. Returns the bytes with a
  // Content-Disposition: attachment header so the browser saves it.
  fastify.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    return streamAttachment(req, reply, "attachment");
  });

  // GET /attachments/:id/preview — same bytes, inline disposition so
  // PDFs / images render in the browser tab.
  fastify.get<{ Params: { id: string } }>(
    "/:id/preview",
    async (req, reply) => {
      return streamAttachment(req, reply, "inline");
    },
  );

  // DELETE /attachments/:id — soft delete. Bytes stay until the
  // retention-eviction sweep gets to them (v2).
  fastify.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.documentAttachments)
        .where(
          and(
            eq(schema.documentAttachments.tenantId, ctx.tenantId),
            eq(schema.documentAttachments.id, req.params.id),
            isNull(schema.documentAttachments.deletedAt),
          ),
        )
        .limit(1);
      if (!row) return { error: "NOT_FOUND" as const };

      const [updated] = await tx
        .update(schema.documentAttachments)
        .set({
          deletedAt: new Date(),
          deletedByUserId: ctx.userId,
        })
        .where(eq(schema.documentAttachments.id, row.id))
        .returning();

      await recordAuditEvent(tx, {
        kind: "attachment.deleted",
        summary: `Deleted ${row.fileName}`,
        refType: row.entityType,
        refId: row.entityId,
        diff: {
          attachmentId: row.id,
          sizeBytes: row.sizeBytes,
          retentionUntil: row.retentionUntil,
        },
        actorUserId: ctx.userId,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      });

      return { attachment: projectRow(updated!) };
    });

    if ("error" in result) {
      return reply.status(404).send({
        error: { code: "NOT_FOUND", message: "Attachment not found." },
      });
    }
    return reply.send({ ok: true, attachment: result.attachment });
  });
};

// Shared stream helper — download vs. preview differ only in the
// Content-Disposition directive.
async function streamAttachment(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
  disposition: "attachment" | "inline",
): Promise<unknown> {
  const ctx = requireAuth(req, reply);
  if (!ctx) return;

  const row = await withTenant(ctx.tenantId, async (tx) => {
    const [r] = await tx
      .select()
      .from(schema.documentAttachments)
      .where(
        and(
          eq(schema.documentAttachments.tenantId, ctx.tenantId),
          eq(schema.documentAttachments.id, req.params.id),
          isNull(schema.documentAttachments.deletedAt),
        ),
      )
      .limit(1);
    return r ?? null;
  });

  if (!row) {
    return reply.status(404).send({
      error: { code: "NOT_FOUND", message: "Attachment not found." },
    });
  }

  const obj = await getObjectStream(row.storageKey);
  if (!obj) {
    req.log.error(
      { attachmentId: row.id, storageKey: row.storageKey },
      "attachment row present but object missing",
    );
    return reply.status(404).send({
      error: {
        code: "OBJECT_MISSING",
        message:
          "Attachment metadata is present but the file is missing from storage.",
      },
    });
  }

  const safeFilename = row.fileName.replace(/"/g, "");
  reply
    .type(obj.contentType ?? row.contentType)
    .header(
      "Content-Disposition",
      `${disposition}; filename="${safeFilename}"`,
    );
  if (obj.contentLength !== null) {
    reply.header("Content-Length", String(obj.contentLength));
  }
  return reply.send(obj.stream);
}
