import type { Metadata } from "next";
import { PortalLoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Customer portal sign-in",
  description: "Sign in to view your invoices and statement.",
};

export default function PortalLoginPage() {
  return (
    <main className="container-p flex min-h-[calc(100vh-4rem)] items-center justify-center py-16">
      <div className="w-full max-w-md">
        <h1 className="text-h1 text-charcoal">Customer portal</h1>
        <p className="mt-3 text-body text-text-secondary">
          Enter the email address your supplier has on file. We'll send you a 6-digit code to
          sign in — no password needed.
        </p>
        <div className="mt-8">
          <PortalLoginForm />
        </div>
        <p className="mt-8 text-caption text-text-tertiary">
          Looking for your team's dashboard?{" "}
          <a href="/login" className="underline-offset-4 hover:underline">
            Staff sign-in
          </a>
          .
        </p>
      </div>
    </main>
  );
}
