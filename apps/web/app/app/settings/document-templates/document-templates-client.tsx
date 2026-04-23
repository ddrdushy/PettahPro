"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Plus,
  Trash2,
  Star,
  Copy,
  CheckCircle2,
  FileText,
} from "lucide-react";
import {
  api,
  ApiError,
  type DocumentTemplate,
  type DocumentTemplateDocType,
  type DocumentTemplateLibraryEntry,
} from "@/lib/api";

// List + manage document templates. Rendered under
// /app/settings/document-templates. Edit page lives at /[id].

const DOC_TYPE_LABELS: Record<DocumentTemplateDocType, string> = {
  invoice: "Invoice",
  quotation: "Quotation",
  credit_note: "Credit note",
  debit_note: "Debit note",
  delivery_note: "Delivery note",
  proforma_invoice: "Proforma invoice",
  bill: "Bill",
  purchase_order: "Purchase order",
  goods_received_note: "Goods received note",
  stock_transfer: "Stock transfer",
  payslip: "Payslip",
  settlement_letter: "Settlement letter",
};

// Sort tenant templates by doc_type, then language, then
// published-first, then most recently updated. Groups the list in a
// way that mirrors how the user thinks about these ("my invoice
// templates", "my PO templates").
function sortTemplates(ts: DocumentTemplate[]): DocumentTemplate[] {
  return [...ts].sort((a, b) => {
    if (a.docType !== b.docType) return a.docType.localeCompare(b.docType);
    if (a.language !== b.language) return a.language.localeCompare(b.language);
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    return a.updatedAt < b.updatedAt ? 1 : -1;
  });
}

export function DocumentTemplatesClient({
  initialTemplates,
  library,
}: {
  initialTemplates: DocumentTemplate[];
  library: DocumentTemplateLibraryEntry[];
}) {
  const router = useRouter();
  const [templates, setTemplates] = useState(initialTemplates);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const grouped = useMemo(() => sortTemplates(templates), [templates]);

  async function cloneFromLibrary(entry: DocumentTemplateLibraryEntry) {
    setError(null);
    setBusy(`lib:${entry.libraryKey}`);
    try {
      const { template } = await api.cloneDocumentTemplateFromLibrary({
        libraryKey: entry.libraryKey,
        language: entry.languages[0] ?? "en",
      });
      setTemplates((prev) => [template, ...prev]);
      router.push(`/app/settings/document-templates/${template.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't clone template");
    } finally {
      setBusy(null);
    }
  }

  async function setDefault(id: string) {
    setError(null);
    setBusy(`def:${id}`);
    try {
      const { template: updated } = await api.setDefaultDocumentTemplate(id);
      setTemplates((prev) =>
        prev.map((t) => {
          if (t.id === updated.id) return updated;
          if (
            t.docType === updated.docType &&
            t.language === updated.language &&
            t.isDefault
          ) {
            return { ...t, isDefault: false };
          }
          return t;
        }),
      );
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : "Couldn't set default — is the template published?",
      );
    } finally {
      setBusy(null);
    }
  }

  async function publish(id: string) {
    setError(null);
    setBusy(`pub:${id}`);
    try {
      const { template: updated } = await api.publishDocumentTemplate(id);
      setTemplates((prev) =>
        prev.map((t) => (t.id === updated.id ? updated : t)),
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't publish");
    } finally {
      setBusy(null);
    }
  }

  async function clone(id: string) {
    setError(null);
    setBusy(`clone:${id}`);
    try {
      const { template } = await api.cloneDocumentTemplate(id);
      setTemplates((prev) => [template, ...prev]);
      router.push(`/app/settings/document-templates/${template.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't clone template");
    } finally {
      setBusy(null);
    }
  }

  async function remove(t: DocumentTemplate) {
    if (!confirm(`Delete "${t.name}"? This can't be undone.`)) return;
    setError(null);
    setBusy(`del:${t.id}`);
    try {
      await api.deleteDocumentTemplate(t.id);
      setTemplates((prev) => prev.filter((x) => x.id !== t.id));
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : "Couldn't delete — default templates must be unset first.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-8 space-y-8">
      {error && (
        <div className="rounded-md border-hairline border-red-200 bg-red-50 px-4 py-3 text-small text-red-700">
          {error}
        </div>
      )}

      <section className="rounded-card border-hairline border-border bg-surface-elevated p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-body font-medium text-charcoal">
              Your templates
            </h2>
            <p className="mt-1 text-caption text-text-secondary">
              Templates you've customised or cloned. Publish a draft to make it
              eligible as a default; set it as the default for its doc-type +
              language to use it when printing.
            </p>
          </div>
          <Link
            href="/app/settings/document-templates/new"
            className="btn-primary text-small"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Blank template
          </Link>
        </div>

        {grouped.length === 0 ? (
          <p className="text-small text-text-secondary">
            No templates yet. Clone a starter from the library below or create a
            blank one.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {grouped.map((t) => (
              <div
                key={t.id}
                className="flex items-start justify-between py-3"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/app/settings/document-templates/${t.id}`}
                      className="truncate text-small font-medium text-charcoal hover:underline"
                    >
                      {t.name}
                    </Link>
                    <span className="rounded-full bg-surface-recessed px-2 py-0.5 text-caption text-text-secondary">
                      {DOC_TYPE_LABELS[t.docType]}
                    </span>
                    <span className="rounded-full bg-surface-recessed px-2 py-0.5 text-caption uppercase text-text-tertiary">
                      {t.language}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-caption ${
                        t.status === "published"
                          ? "bg-mint-surface text-mint-dark"
                          : t.status === "draft"
                            ? "bg-surface-recessed text-text-secondary"
                            : "bg-surface-recessed text-text-tertiary"
                      }`}
                    >
                      {t.status}
                    </span>
                    {t.isDefault && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-mint-surface px-2 py-0.5 text-caption text-mint-dark">
                        <Star className="h-3 w-3" aria-hidden /> Default
                      </span>
                    )}
                    <span className="text-caption text-text-tertiary">
                      v{t.version}
                    </span>
                    {t.libraryKey && (
                      <span className="text-caption text-text-tertiary">
                        · based on {t.libraryKey}
                      </span>
                    )}
                  </div>
                  {t.description && (
                    <p className="mt-1 truncate text-caption text-text-secondary">
                      {t.description}
                    </p>
                  )}
                </div>
                <div className="ml-4 flex shrink-0 items-center gap-1">
                  {t.status === "draft" && (
                    <button
                      type="button"
                      className="btn-ghost text-caption"
                      disabled={busy === `pub:${t.id}`}
                      onClick={() => publish(t.id)}
                      title="Publish this draft"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                      Publish
                    </button>
                  )}
                  {t.status === "published" && !t.isDefault && (
                    <button
                      type="button"
                      className="btn-ghost text-caption"
                      disabled={busy === `def:${t.id}`}
                      onClick={() => setDefault(t.id)}
                      title="Use this template by default"
                    >
                      <Star className="h-3.5 w-3.5" aria-hidden />
                      Set default
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-ghost text-caption"
                    disabled={busy === `clone:${t.id}`}
                    onClick={() => clone(t.id)}
                    title="Clone as a new draft"
                  >
                    <Copy className="h-3.5 w-3.5" aria-hidden />
                    Clone
                  </button>
                  {!t.isDefault && (
                    <button
                      type="button"
                      className="btn-ghost text-caption text-red-600"
                      disabled={busy === `del:${t.id}`}
                      onClick={() => remove(t)}
                      title="Delete template"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-card border-hairline border-border bg-surface-elevated p-6">
        <div className="mb-4">
          <h2 className="text-body font-medium text-charcoal">
            Template library
          </h2>
          <p className="mt-1 text-caption text-text-secondary">
            Professionally-designed starters. Clone one into your tenant to
            customise — the original stays available for future clones. More
            templates (quotation, purchase order, GRN, payment advice, thermal
            POS receipt) are on the roadmap.
          </p>
        </div>
        {library.length === 0 ? (
          <p className="text-small text-text-secondary">No library templates available.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {library.map((l) => (
              <div
                key={l.libraryKey}
                className="rounded-md border-hairline border-border p-4"
              >
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-text-tertiary" aria-hidden />
                  <h3 className="text-small font-medium text-charcoal">
                    {l.name}
                  </h3>
                  <span className="rounded-full bg-surface-recessed px-2 py-0.5 text-caption text-text-secondary">
                    {DOC_TYPE_LABELS[l.docType]}
                  </span>
                </div>
                <p className="mt-2 text-caption text-text-secondary">
                  {l.description}
                </p>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-caption text-text-tertiary">
                    Languages: {l.languages.join(", ").toUpperCase()}
                  </span>
                  <button
                    type="button"
                    className="btn-secondary text-caption"
                    disabled={busy === `lib:${l.libraryKey}`}
                    onClick={() => cloneFromLibrary(l)}
                  >
                    <Copy className="h-3.5 w-3.5" aria-hidden />
                    Clone to tenant
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
