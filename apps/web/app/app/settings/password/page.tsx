import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { ChangePasswordForm } from "./change-password-form";

export const metadata: Metadata = { title: "Change password" };

export default function ChangePasswordPage() {
  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="Account"
        title="Change password"
        description="Pick something strong and unique. After saving, you'll stay signed in on this tab but every other session for your account is signed out — useful if you think someone else had access."
      />
      <section className="mt-6 max-w-xl rounded-card border-hairline border-border bg-surface-elevated p-6">
        <ChangePasswordForm />
      </section>
    </main>
  );
}
