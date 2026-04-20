import type { Metadata } from "next";
import Link from "next/link";
import { SignupForm } from "@/components/auth/signup-form";

export const metadata: Metadata = {
  title: "Start your free trial",
  description: "Create your PettahPro account. 30-day free trial, no credit card.",
};

export default function SignupPage() {
  return (
    <div>
      <h1 className="text-h1 text-charcoal">Start your 30-day trial</h1>
      <p className="mt-3 text-body text-text-secondary">
        Two minutes to set up. No credit card. Import your current books when you're ready.
      </p>

      <div className="mt-8">
        <SignupForm />
      </div>

      <p className="mt-6 text-small text-text-secondary">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-charcoal underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
