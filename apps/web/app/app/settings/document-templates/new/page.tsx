import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { NewDocumentTemplateClient } from "./new-client";

export const metadata: Metadata = { title: "New document template" };

export default function NewDocumentTemplatePage() {
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
        title="New document template"
        description="Create a blank template. Pick a document type and language, give it a name, then customise the layout on the next screen."
      />
      <NewDocumentTemplateClient />
    </main>
  );
}
