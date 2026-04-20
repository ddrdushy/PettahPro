import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to PettahPro.",
};

export default function LoginPage() {
  return (
    <div>
      <h1 className="text-h1 text-charcoal">Welcome back</h1>
      <p className="mt-3 text-body text-text-secondary">Sign in to continue with your books.</p>

      <div className="mt-8">
        <LoginForm />
      </div>

      <p className="mt-6 text-small text-text-secondary">
        New to PettahPro?{" "}
        <Link href="/signup" className="font-medium text-charcoal underline-offset-4 hover:underline">
          Start a free trial
        </Link>
      </p>
    </div>
  );
}
