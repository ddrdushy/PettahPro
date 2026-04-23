"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Download,
  Eye,
  FileText,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import {
  api,
  ApiError,
  type DocumentAttachmentEntityType,
  type DocumentAttachmentRow,
} from "@/lib/api";

// Attachments panel (roadmap #32) — drops onto any detail page.
// Renders a drag/drop zone + list of files with preview / download /
// delete. One file at a time (matches the server-side contract).
//
// Defaults: 10 MB cap enforced client-side for a friendlier error than
// the server's 413, plus the allow-list so we pre-filter obvious
// mistakes (.exe, .app bundles, etc.) before spending an upload.

const MAX_BYTES = 10 * 1024 * 1024;

const ACCEPT_MIME = [
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
].join(",");

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isImage(contentType: string): boolean {
  return contentType.startsWith("image/");
}

function isPreviewable(contentType: string): boolean {
  // PDFs render in an <iframe>; browsers handle images directly.
  return contentType === "application/pdf" || isImage(contentType);
}

export function AttachmentsPanel({
  entityType,
  entityId,
  className,
}: {
  entityType: DocumentAttachmentEntityType;
  entityId: string;
  className?: string;
}) {
  const [rows, setRows] = useState<DocumentAttachmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState<DocumentAttachmentRow | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { attachments } = await api.listAttachments(entityType, entityId);
      setRows(attachments);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Couldn't load attachments.",
      );
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onUpload(file: File) {
    setError(null);
    if (file.size === 0) {
      setError("The selected file is empty.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("File exceeds the 10 MB per-file limit.");
      return;
    }
    setUploading(true);
    try {
      await api.uploadAttachment(entityType, entityId, file);
      await load();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Couldn't upload the file.",
      );
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function onDelete(row: DocumentAttachmentRow) {
    // Hard confirm — soft-delete hides from the UI but the bytes stay
    // around until retention_until passes; still a surprising action
    // without a speed-bump.
    const ok = window.confirm(`Delete "${row.fileName}"? This can't be undone from the UI.`);
    if (!ok) return;
    setError(null);
    try {
      await api.deleteAttachment(row.id);
      setRows((cur) => cur.filter((r) => r.id !== row.id));
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Couldn't delete the file.",
      );
    }
  }

  function onDrop(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void onUpload(file);
  }

  return (
    <section
      className={`rounded-md border-hairline border-border bg-surface-raised ${
        className ?? ""
      }`}
    >
      <header className="flex items-center justify-between border-b-hairline border-border px-4 py-3">
        <div className="flex items-center gap-2 text-body font-medium text-text-primary">
          <Paperclip className="h-4 w-4 text-text-tertiary" aria-hidden />
          Attachments
          {rows.length > 0 && (
            <span className="rounded-full bg-surface-recessed px-2 py-0.5 text-caption text-text-secondary">
              {rows.length}
            </span>
          )}
        </div>
      </header>

      <div className="p-4 space-y-4">
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-hairline border-dashed px-4 py-6 text-center transition-colors ${
            dragOver
              ? "border-primary/60 bg-primary-bg/40"
              : "border-border bg-surface-recessed/40 hover:bg-surface-recessed"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT_MIME}
            className="sr-only"
            disabled={uploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onUpload(f);
            }}
          />
          {uploading ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin text-text-tertiary" aria-hidden />
              <div className="text-small text-text-secondary">Uploading…</div>
            </>
          ) : (
            <>
              <UploadCloud className="h-5 w-5 text-text-tertiary" aria-hidden />
              <div className="text-small text-text-secondary">
                Drop a file here, or click to browse
              </div>
              <div className="text-caption text-text-tertiary">
                PDF, images, Word, Excel, CSV, TXT · max 10 MB
              </div>
            </>
          )}
        </label>

        {error && (
          <div
            role="alert"
            className="rounded-md border-hairline border-danger/40 bg-danger-bg/50 px-3 py-2 text-small text-danger"
          >
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-small text-text-tertiary">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Loading attachments…
          </div>
        ) : rows.length === 0 ? (
          <div className="text-small text-text-tertiary">No attachments yet.</div>
        ) : (
          <ul className="divide-y-hairline divide-border">
            {rows.map((row) => (
              <li
                key={row.id}
                className="flex items-center gap-3 py-2 first:pt-0 last:pb-0"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-recessed text-text-tertiary">
                  {isImage(row.contentType) ? (
                    <ImageIcon className="h-4 w-4" aria-hidden />
                  ) : (
                    <FileText className="h-4 w-4" aria-hidden />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-small font-medium text-text-primary">
                    {row.fileName}
                  </div>
                  <div className="truncate text-caption text-text-tertiary">
                    {formatBytes(row.sizeBytes)} · uploaded {formatWhen(row.uploadedAt)}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {isPreviewable(row.contentType) && (
                    <button
                      type="button"
                      onClick={() => setPreview(row)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-surface-recessed hover:text-text-primary"
                      aria-label={`Preview ${row.fileName}`}
                      title="Preview"
                    >
                      <Eye className="h-4 w-4" aria-hidden />
                    </button>
                  )}
                  <a
                    href={api.attachmentDownloadUrl(row.id)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-surface-recessed hover:text-text-primary"
                    aria-label={`Download ${row.fileName}`}
                    title="Download"
                  >
                    <Download className="h-4 w-4" aria-hidden />
                  </a>
                  <button
                    type="button"
                    onClick={() => onDelete(row)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-danger-bg hover:text-danger"
                    aria-label={`Delete ${row.fileName}`}
                    title="Delete"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {preview && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Preview ${preview.fileName}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setPreview(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative flex h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-surface-raised shadow-xl"
          >
            <div className="flex items-center justify-between border-b-hairline border-border px-4 py-3">
              <div className="min-w-0 truncate text-body font-medium text-text-primary">
                {preview.fileName}
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={api.attachmentDownloadUrl(preview.id)}
                  className="inline-flex items-center gap-1 rounded-md border-hairline border-border px-3 py-1.5 text-small text-text-secondary hover:bg-surface-recessed"
                >
                  <Download className="h-4 w-4" aria-hidden />
                  Download
                </a>
                <button
                  type="button"
                  onClick={() => setPreview(null)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-tertiary hover:bg-surface-recessed hover:text-text-primary"
                  aria-label="Close preview"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </div>
            </div>
            <div className="flex flex-1 items-center justify-center overflow-auto bg-surface-recessed">
              {isImage(preview.contentType) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={api.attachmentPreviewUrl(preview.id)}
                  alt={preview.fileName}
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <iframe
                  src={api.attachmentPreviewUrl(preview.id)}
                  title={preview.fileName}
                  className="h-full w-full border-0"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
