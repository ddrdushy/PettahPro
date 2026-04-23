import type { Metadata } from "next";
import Link from "next/link";
import { VerifyForm } from "./verify-form";

export const metadata: Metadata = {
  title: "Enter sign-in code",
};

export default function VerifyPage({
  searchParams,
}: {
  searchParams: { email?: string };
}) {
  const email = searchParams.email ?? "";
  return (
    <main className="container-p flex min-h-[calc(100vh-4rem)] items-center justify-center py-16">
      <div className="w-full max-w-md">
        <h1 className="text-h1 text-charcoal">Check your email</h1>
        <p className="mt-3 text-body text-text-secondary">
          We've sent a 6-digit code to {email ? <strong>{email}</strong> : "your inbox"}.
          It's good for 10 minutes.
        </p>
        <div className="mt-8">
          <VerifyForm email={email} />
        </div>
        <p className="mt-6 text-caption text-text-tertiary">
          Didn't get a code?{" "}
          <Link href="/portal/login" className="underline-offset-4 hover:underline">
            Try a different email
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
