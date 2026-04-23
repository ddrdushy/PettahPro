import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowLeft } from "lucide-react";
import type {
  DocumentTemplate,
  DocumentTemplateLibraryEntry,
} from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { DocumentTemplatesClient } from "./document-templates-client";

export const metadata: Metadata = { title: "Document templates" };

async function fetchAll(): Promise<{
  templates: DocumentTemplate[];
  library: DocumentTemplateLibraryEntry[];
}> {
  const base = process.env.INTERNAL_API_URL ?? "http://api:4000";
  const cookie = cookies().toString();
  const [tRes, lRes] = await Promise.all([
    fetch(`${base}/document-templates`, {
      headers: { cookie },
      cache: "no-store",
    }),
    fetch(`${base}/document-templates/library`, {
      headers: { cookie },
      cache: "no-store",
    }),
  ]);
  const templates = tRes.ok
    ? ((await tRes.json()) as { templates: DocumentTemplate[] }).templates
    : [];
  const library = lRes.ok
    ? ((await lRes.json()) as { templates: DocumentTemplateLibraryEntry[] })
        .templates
    : [];
  return { templates, library };
}

export default async function DocumentTemplatesPage() {
  const { templates, library } = await fetchAll();

  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link href="/app/settings" className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to settings
        </Link>
      </div>
      <PageHeader
        eyebrow="Admin"
        title="Document templates"
        description="Per-tenant layouts for printed documents. Clone a starter from the library or build a blank template from scratch, edit its sections, publish, then set it as the default for its doc-type and language. Invoices already use the template engine; other document types fall back to the built-in layouts until the engine grows their section blocks."
      />
      <DocumentTemplatesClient
        initialTemplates={templates}
        library={library}
      />
    </main>
  );
}
