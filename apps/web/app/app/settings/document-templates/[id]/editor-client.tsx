"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Save,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  RotateCcw,
} from "lucide-react";
import {
  api,
  ApiError,
  type DocumentTemplate,
} from "@/lib/api";

// Structured editor for a document template. v1 is a section-list
// editor — not the full drag-drop WYSIWYG called out in sell §19.1;
// that's a v2 follow-up once the engine proves itself. Each section
// type exposes a small set of toggles and text fields. The layout
// JSON shape matches apps/web/lib/template-renderer.tsx so edits
// flow straight through to the render path.

type PageSize = "a4" | "a5" | "thermal_80" | "thermal_58";

type Theme = {
  accentColor: string;
  mutedColor: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  borderColor: string;
  surfaceRecessed: string;
  fontFamily: string;
  fontSize: number;
};

type Section =
  | { type: "header"; showLogo?: boolean; showStatusPill?: boolean }
  | { type: "metaRow"; fields?: string[] }
  | { type: "billTo" }
  | { type: "lineItemsTable" }
  | { type: "totals"; showTaxBreakdown?: boolean }
  | { type: "notes" }
  | { type: "footer"; text?: string }
  | { type: "spacer"; height?: number }
  | {
      type: "text";
      text: string;
      emphasis?: "default" | "muted" | "label";
    };

type Layout = {
  pageSize: PageSize;
  theme: Theme;
  sections: Section[];
};

const DEFAULT_THEME: Theme = {
  accentColor: "#3D6B52",
  mutedColor: "#E8EDE9",
  textPrimary: "#1A1A1A",
  textSecondary: "#5F5E5A",
  textTertiary: "#888780",
  borderColor: "#E5E5E3",
  surfaceRecessed: "#F1EFE8",
  fontFamily: "Helvetica",
  fontSize: 10,
};

function parseLayout(raw: unknown): Layout {
  const r = (raw ?? {}) as Partial<Layout>;
  return {
    pageSize: (r.pageSize as PageSize) ?? "a4",
    theme: { ...DEFAULT_THEME, ...(r.theme ?? {}) },
    sections: Array.isArray(r.sections) ? (r.sections as Section[]) : [],
  };
}

const SECTION_LABELS: Record<Section["type"], string> = {
  header: "Header",
  metaRow: "Meta row (dates, reference, PO)",
  billTo: "Bill-to / customer block",
  lineItemsTable: "Line items table",
  totals: "Totals block",
  notes: "Notes + terms",
  footer: "Footer",
  spacer: "Spacer",
  text: "Free text",
};

function blankSection(type: Section["type"]): Section {
  switch (type) {
    case "header":
      return { type: "header", showLogo: true, showStatusPill: true };
    case "metaRow":
      return {
        type: "metaRow",
        fields: ["invoiceDate", "dueDate", "reference", "poNumber"],
      };
    case "billTo":
      return { type: "billTo" };
    case "lineItemsTable":
      return { type: "lineItemsTable" };
    case "totals":
      return { type: "totals", showTaxBreakdown: true };
    case "notes":
      return { type: "notes" };
    case "footer":
      return { type: "footer", text: "Thank you for your business." };
    case "spacer":
      return { type: "spacer", height: 12 };
    case "text":
      return { type: "text", text: "", emphasis: "default" };
  }
}

export function DocumentTemplateEditorClient({
  initial,
}: {
  initial: DocumentTemplate;
}) {
  const router = useRouter();
  const [template, setTemplate] = useState<DocumentTemplate>(initial);
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description ?? "");
  const [layout, setLayout] = useState<Layout>(parseLayout(initial.layoutJson));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = useMemo(() => {
    if (name !== template.name) return true;
    if ((description || null) !== (template.description || null)) return true;
    return (
      JSON.stringify(layout) !== JSON.stringify(parseLayout(template.layoutJson))
    );
  }, [name, description, layout, template]);

  async function save() {
    setError(null);
    setSaving(true);
    try {
      const { template: updated } = await api.updateDocumentTemplate(
        template.id,
        {
          name,
          description: description || null,
          layout: layout as unknown as Record<string, unknown>,
        },
      );
      setTemplate(updated);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save template");
    } finally {
      setSaving(false);
    }
  }

  async function publishNow() {
    await save();
    if (error) return;
    try {
      const { template: updated } = await api.publishDocumentTemplate(
        template.id,
      );
      setTemplate(updated);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't publish");
    }
  }

  function addSection(type: Section["type"]) {
    setLayout((l) => ({ ...l, sections: [...l.sections, blankSection(type)] }));
  }

  function removeSection(idx: number) {
    setLayout((l) => ({
      ...l,
      sections: l.sections.filter((_, i) => i !== idx),
    }));
  }

  function moveSection(idx: number, dir: -1 | 1) {
    setLayout((l) => {
      const next = [...l.sections];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return l;
      const src = next[idx]!;
      const dst = next[target]!;
      next[idx] = dst;
      next[target] = src;
      return { ...l, sections: next };
    });
  }

  function updateSection(idx: number, patch: Partial<Section>) {
    setLayout((l) => ({
      ...l,
      sections: l.sections.map((s, i) =>
        i === idx ? ({ ...s, ...patch } as Section) : s,
      ),
    }));
  }

  function resetToOriginal() {
    setName(template.name);
    setDescription(template.description ?? "");
    setLayout(parseLayout(template.layoutJson));
  }

  return (
    <div className="mt-8 space-y-6">
      {error && (
        <div className="rounded-md border-hairline border-red-200 bg-red-50 px-4 py-3 text-small text-red-700">
          {error}
        </div>
      )}

      <section className="rounded-card border-hairline border-border bg-surface-elevated p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-body font-medium text-charcoal">
              Template details
            </h2>
            <p className="mt-1 text-caption text-text-secondary">
              Version {template.version} · {template.status} · {template.docType} · {template.language.toUpperCase()}
              {template.isDefault && " · default"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {dirty && (
              <button
                type="button"
                className="btn-ghost text-caption"
                onClick={resetToOriginal}
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                Discard changes
              </button>
            )}
            <button
              type="button"
              className="btn-secondary text-small"
              disabled={saving || !dirty}
              onClick={save}
            >
              <Save className="h-3.5 w-3.5" aria-hidden />
              {saving ? "Saving…" : "Save"}
            </button>
            {template.status === "draft" && (
              <button
                type="button"
                className="btn-primary text-small"
                disabled={saving}
                onClick={publishNow}
              >
                Save + publish
              </button>
            )}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-caption text-text-secondary">Name</span>
            <input
              className="input mt-1"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="text-caption text-text-secondary">Description</span>
            <textarea
              className="input mt-1"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
        </div>
      </section>

      <section className="rounded-card border-hairline border-border bg-surface-elevated p-6">
        <h2 className="mb-4 text-body font-medium text-charcoal">
          Page &amp; theme
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-caption text-text-secondary">Page size</span>
            <select
              className="input mt-1"
              value={layout.pageSize}
              onChange={(e) =>
                setLayout((l) => ({
                  ...l,
                  pageSize: e.target.value as PageSize,
                }))
              }
            >
              <option value="a4">A4</option>
              <option value="a5">A5</option>
              <option value="thermal_80">Thermal receipt (80mm)</option>
              <option value="thermal_58">Thermal receipt (58mm)</option>
            </select>
          </label>
          <label className="block">
            <span className="text-caption text-text-secondary">Accent colour</span>
            <input
              className="input mt-1"
              type="color"
              value={layout.theme.accentColor}
              onChange={(e) =>
                setLayout((l) => ({
                  ...l,
                  theme: { ...l.theme, accentColor: e.target.value },
                }))
              }
            />
          </label>
          <label className="block">
            <span className="text-caption text-text-secondary">Muted accent</span>
            <input
              className="input mt-1"
              type="color"
              value={layout.theme.mutedColor}
              onChange={(e) =>
                setLayout((l) => ({
                  ...l,
                  theme: { ...l.theme, mutedColor: e.target.value },
                }))
              }
            />
          </label>
          <label className="block">
            <span className="text-caption text-text-secondary">Font family</span>
            <select
              className="input mt-1"
              value={layout.theme.fontFamily}
              onChange={(e) =>
                setLayout((l) => ({
                  ...l,
                  theme: { ...l.theme, fontFamily: e.target.value },
                }))
              }
            >
              <option value="Helvetica">Helvetica</option>
              <option value="Times-Roman">Times</option>
              <option value="Courier">Courier</option>
            </select>
          </label>
        </div>
      </section>

      <section className="rounded-card border-hairline border-border bg-surface-elevated p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-body font-medium text-charcoal">Sections</h2>
          <div className="flex flex-wrap gap-1">
            {(Object.keys(SECTION_LABELS) as Section["type"][]).map((t) => (
              <button
                key={t}
                type="button"
                className="btn-ghost text-caption"
                onClick={() => addSection(t)}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                {SECTION_LABELS[t]}
              </button>
            ))}
          </div>
        </div>

        {layout.sections.length === 0 ? (
          <p className="text-small text-text-secondary">
            No sections yet. Add a header to start.
          </p>
        ) : (
          <ul className="space-y-2">
            {layout.sections.map((section, i) => (
              <li
                key={i}
                className="rounded-md border-hairline border-border p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-small font-medium text-charcoal">
                    {i + 1}. {SECTION_LABELS[section.type]}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="btn-ghost p-1"
                      disabled={i === 0}
                      onClick={() => moveSection(i, -1)}
                      title="Move up"
                    >
                      <ArrowUp className="h-3.5 w-3.5" aria-hidden />
                    </button>
                    <button
                      type="button"
                      className="btn-ghost p-1"
                      disabled={i === layout.sections.length - 1}
                      onClick={() => moveSection(i, 1)}
                      title="Move down"
                    >
                      <ArrowDown className="h-3.5 w-3.5" aria-hidden />
                    </button>
                    <button
                      type="button"
                      className="btn-ghost p-1 text-red-600"
                      onClick={() => removeSection(i)}
                      title="Remove"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </div>
                </div>
                <SectionFields
                  section={section}
                  onChange={(patch) => updateSection(i, patch)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function SectionFields({
  section,
  onChange,
}: {
  section: Section;
  onChange: (patch: Partial<Section>) => void;
}) {
  switch (section.type) {
    case "header":
      return (
        <div className="mt-3 flex flex-wrap gap-4">
          <label className="inline-flex items-center gap-2 text-caption">
            <input
              type="checkbox"
              checked={section.showStatusPill !== false}
              onChange={(e) =>
                onChange({ showStatusPill: e.target.checked } as Partial<Section>)
              }
            />
            Show status pill
          </label>
        </div>
      );
    case "metaRow":
      return (
        <div className="mt-3">
          <p className="text-caption text-text-secondary">
            Fields shown in the meta row (comma-separated)
          </p>
          <input
            className="input mt-1"
            value={(section.fields ?? []).join(", ")}
            onChange={(e) =>
              onChange({
                fields: e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              } as Partial<Section>)
            }
            placeholder="invoiceDate, dueDate, reference, poNumber"
          />
          <p className="mt-1 text-caption text-text-tertiary">
            Options: invoiceDate, dueDate, reference, poNumber, currency, invoiceNumber
          </p>
        </div>
      );
    case "totals":
      return (
        <div className="mt-3 flex flex-wrap gap-4">
          <label className="inline-flex items-center gap-2 text-caption">
            <input
              type="checkbox"
              checked={section.showTaxBreakdown !== false}
              onChange={(e) =>
                onChange({
                  showTaxBreakdown: e.target.checked,
                } as Partial<Section>)
              }
            />
            Show tax breakdown
          </label>
        </div>
      );
    case "footer":
      return (
        <div className="mt-3">
          <label className="block text-caption text-text-secondary">
            Footer text
          </label>
          <input
            className="input mt-1"
            value={section.text ?? ""}
            onChange={(e) =>
              onChange({ text: e.target.value } as Partial<Section>)
            }
            placeholder="Thank you for your business."
          />
        </div>
      );
    case "spacer":
      return (
        <div className="mt-3">
          <label className="block text-caption text-text-secondary">
            Height (pt)
          </label>
          <input
            type="number"
            className="input mt-1"
            value={section.height ?? 12}
            min={1}
            max={200}
            onChange={(e) =>
              onChange({
                height: Number(e.target.value) || 12,
              } as Partial<Section>)
            }
          />
        </div>
      );
    case "text":
      return (
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
          <input
            className="input"
            value={section.text ?? ""}
            onChange={(e) =>
              onChange({ text: e.target.value } as Partial<Section>)
            }
            placeholder="Any free text — e.g. jurisdiction clause"
          />
          <select
            className="input"
            value={section.emphasis ?? "default"}
            onChange={(e) =>
              onChange({
                emphasis: e.target.value as "default" | "muted" | "label",
              } as Partial<Section>)
            }
          >
            <option value="default">Default</option>
            <option value="muted">Muted</option>
            <option value="label">Label</option>
          </select>
        </div>
      );
    default:
      return null;
  }
}
