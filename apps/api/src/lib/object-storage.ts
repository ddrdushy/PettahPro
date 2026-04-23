import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from "@aws-sdk/client-s3";
import type { Readable } from "node:stream";

// Object storage adapter for document attachments (roadmap #32).
//
// Self-hosted preference: defaults wire to the MinIO service that
// already runs in docker-compose.yml. In production we'd override
// S3_ENDPOINT / credentials via env to target a managed S3 (or a
// self-hosted MinIO cluster per our OSS-first policy).
//
// The wrapper is intentionally tiny — put / get / delete / ensure
// bucket. Presigned URLs, multi-part, and lifecycle rules (for the
// retention-eviction sweep) are v2 follow-ups; for now the API
// streams through itself which is fine at our size.

const ENDPOINT =
  process.env.S3_ENDPOINT ??
  process.env.MINIO_ENDPOINT ??
  // Docker-compose service name — works from both the `api` and
  // `worker` containers. Local dev outside docker should set
  // S3_ENDPOINT=http://localhost:9000.
  "http://minio:9000";

const REGION = process.env.S3_REGION ?? "us-east-1";

const ACCESS_KEY =
  process.env.S3_ACCESS_KEY ??
  process.env.MINIO_ROOT_USER ??
  "pettahpro";

const SECRET_KEY =
  process.env.S3_SECRET_KEY ??
  process.env.MINIO_ROOT_PASSWORD ??
  "pettahpro_dev";

export const S3_BUCKET = process.env.S3_BUCKET ?? "pettahpro-attachments";

// MinIO requires path-style addressing; real S3 supports both.
// Defaulting to path-style is the safer dev default.
const FORCE_PATH_STYLE = (process.env.S3_FORCE_PATH_STYLE ?? "true") === "true";

let _client: S3Client | null = null;

export function getS3Client(): S3Client {
  if (_client) return _client;
  _client = new S3Client({
    region: REGION,
    endpoint: ENDPOINT,
    forcePathStyle: FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: ACCESS_KEY,
      secretAccessKey: SECRET_KEY,
    },
  });
  return _client;
}

/**
 * Upload bytes to the attachments bucket. `body` is either a Buffer
 * (whole file in memory — fine for our 10 MB cap) or a Node Readable
 * stream. Callers should set a UUID-prefixed `key` so two uploads of
 * the same filename for the same entity don't collide.
 */
export async function putObject(
  key: string,
  body: Buffer | Uint8Array | Readable,
  contentType: string,
): Promise<void> {
  const client = getS3Client();
  await client.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

/**
 * Fetch an object's byte stream. Caller is responsible for pumping it
 * into the fastify reply (see the download / preview routes).
 *
 * Returns null if the object is missing — preferable to throwing at
 * every call site for the benign not-found case.
 */
export async function getObjectStream(key: string): Promise<{
  stream: Readable;
  contentLength: number | null;
  contentType: string | null;
} | null> {
  const client = getS3Client();
  try {
    const res = await client.send(
      new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }),
    );
    // aws-sdk v3 streams the body as a Node Readable in Node envs.
    const body = res.Body as Readable | undefined;
    if (!body) return null;
    return {
      stream: body,
      contentLength:
        typeof res.ContentLength === "number" ? res.ContentLength : null,
      contentType: res.ContentType ?? null,
    };
  } catch (err) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404) {
      return null;
    }
    throw err;
  }
}

/**
 * Hard-delete an object. Only invoked by the retention-eviction
 * sweep (v2) — the `DELETE /attachments/:id` API does a soft delete
 * and leaves the bytes on disk until `retention_until` passes.
 */
export async function deleteObject(key: string): Promise<void> {
  const client = getS3Client();
  await client.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key }));
}

/**
 * Create the bucket if it doesn't exist. Called once at API boot so a
 * fresh dev environment (or a new self-hosted deploy) Just Works
 * after `docker compose up`. Failures here are logged but don't crash
 * the server — the attachment endpoints will 503 on use which is the
 * right signal.
 */
export async function ensureBucket(): Promise<void> {
  const client = getS3Client();
  try {
    await client.send(new HeadBucketCommand({ Bucket: S3_BUCKET }));
    return;
  } catch (err) {
    const e = err as { $metadata?: { httpStatusCode?: number } };
    const status = e?.$metadata?.httpStatusCode;
    if (status !== 404 && status !== 403 && status !== undefined) {
      // Some other error (credentials / network) — let the create
      // attempt below surface the real problem.
    }
  }
  try {
    await client.send(new CreateBucketCommand({ Bucket: S3_BUCKET }));
  } catch (err) {
    const e = err as { name?: string };
    // Race — another boot won. Fine.
    if (
      e?.name === "BucketAlreadyOwnedByYou" ||
      e?.name === "BucketAlreadyExists"
    ) {
      return;
    }
    throw err;
  }
}

/**
 * Compose an object-store key for an attachment. Tenant-prefixed so a
 * bucket-ACL misconfiguration still can't cross tenants. UUID suffix
 * guards against filename collisions across two users uploading the
 * same file to the same entity.
 */
export function buildStorageKey(input: {
  tenantId: string;
  entityType: string;
  entityId: string;
  attachmentId: string;
  fileName: string;
}): string {
  const safeName = sanitizeFilename(input.fileName);
  return `${input.tenantId}/${input.entityType}/${input.entityId}/${input.attachmentId}-${safeName}`;
}

// Keep filenames safe as URL + S3 key segments. Collapses unsafe
// characters to `_`, trims leading dots (no hidden dotfiles), and
// bounds the length so the full key stays under any reasonable S3
// 1024-byte key ceiling.
function sanitizeFilename(name: string): string {
  const trimmed = name.replace(/^\.+/, "").trim();
  const replaced = trimmed.replace(/[^A-Za-z0-9._-]+/g, "_");
  const bounded = replaced.slice(0, 180);
  return bounded.length > 0 ? bounded : "file";
}
