import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import type { DocumentTemplate } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { DocumentTemplateEditorClient } from "./editor-client";

export const metadata: Metadata = { title: "Edit document template" };

async function fetchTemplate(id: string): Promise<DocumentTemplate | null> {
  const base = process.env.INTERNAL_API_URL ?? "http://api:4000";
  const res = await fetch(`${base}/document-templates/${id}`, {
    headers: { cookie: cookies().toString() },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { template: DocumentTemplate };
  return body.template;
}

export default async function EditDocumentTemplatePage({
  params,
}: {
  params: { id: string };
}) {
  const template = await fetchTemplate(params.id);
  if (!template) notFound();

  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link
          href="/app/settings/document-templates"
          className="btn-link text-small"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to templates
        </Link>
      </div>
      <PageHeader
        eyebrow="Admin"
        title={template.name}
        description="Edit the template's sections, theme, and page size. Save as a draft, then publish when you're ready. The preview link opens a live PDF rendered from the current draft — point it at a real invoice to see the layout against real data."
      />
      <DocumentTemplateEditorClient initial={template} />
    </main>
  );
}
