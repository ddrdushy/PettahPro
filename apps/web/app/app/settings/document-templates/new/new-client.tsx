"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  api,
  ApiError,
  type DocumentTemplateDocType,
} from "@/lib/api";

const DOC_TYPES: Array<{ value: DocumentTemplateDocType; label: string }> = [
  { value: "invoice", label: "Invoice" },
  { value: "quotation", label: "Quotation" },
  { value: "credit_note", label: "Credit note" },
  { value: "debit_note", label: "Debit note" },
  { value: "delivery_note", label: "Delivery note" },
  { value: "proforma_invoice", label: "Proforma invoice" },
  { value: "bill", label: "Bill" },
  { value: "purchase_order", label: "Purchase order" },
  { value: "goods_received_note", label: "Goods received note" },
  { value: "stock_transfer", label: "Stock transfer" },
  { value: "payslip", label: "Payslip" },
  { value: "settlement_letter", label: "Settlement letter" },
];

export function NewDocumentTemplateClient() {
  const router = useRouter();
  const [docType, setDocType] = useState<DocumentTemplateDocType>("invoice");
  const [language, setLanguage] = useState("en");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const { template } = await api.createDocumentTemplate({
        docType,
        language,
        name,
        description: description || undefined,
        // Reasonable default sections so the editor isn't empty.
        // Users can delete any they don't want.
        layout: {
          pageSize: "a4",
          theme: {},
          sections: [
            { type: "header", showStatusPill: true },
            {
              type: "metaRow",
              fields: ["invoiceDate", "dueDate", "reference", "poNumber"],
            },
            { type: "billTo" },
            { type: "lineItemsTable" },
            { type: "totals", showTaxBreakdown: true },
            { type: "notes" },
            { type: "footer", text: "Thank you for your business." },
          ],
        },
      });
      router.push(`/app/settings/document-templates/${template.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't create template");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mt-8 space-y-4 rounded-card border-hairline border-border bg-surface-elevated p-6"
    >
      {error && (
        <div className="rounded-md border-hairline border-red-200 bg-red-50 px-4 py-3 text-small text-red-700">
          {error}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-caption text-text-secondary">Document type</span>
          <select
            className="input mt-1"
            value={docType}
            onChange={(e) =>
              setDocType(e.target.value as DocumentTemplateDocType)
            }
          >
            {DOC_TYPES.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-caption text-text-secondary">Language</span>
          <select
            className="input mt-1"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
          >
            <option value="en">English</option>
            <option value="ta">Tamil</option>
            <option value="si">Sinhala</option>
          </select>
        </label>
        <label className="block sm:col-span-2">
          <span className="text-caption text-text-secondary">Name</span>
          <input
            required
            className="input mt-1"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Branded invoice — English"
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="text-caption text-text-secondary">Description</span>
          <textarea
            rows={2}
            className="input mt-1"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Short note for your team (optional)"
          />
        </label>
      </div>
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={saving || !name.trim()}
          className="btn-primary text-small"
        >
          {saving ? "Creating…" : "Create template"}
        </button>
      </div>
      <p className="text-caption text-text-tertiary">
        Templates start as drafts and aren't used for printing until you
        publish and set them as the default for their document type and
        language. The only document type currently wired to the template
        engine is <strong>Invoice</strong> — other types still use the
        built-in layouts until follow-up PRs migrate them.
      </p>
    </form>
  );
}
