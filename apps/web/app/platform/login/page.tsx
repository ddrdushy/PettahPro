import type { Metadata } from "next";
import { PlatformLoginForm } from "@/components/platform/login-form";

export const metadata: Metadata = {
  title: "Platform sign in",
  description: "PettahPro platform administration sign in.",
};

export default function PlatformLoginPage() {
  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center px-6 py-16">
      <div className="w-full max-w-md rounded-card border border-white/10 bg-white/5 p-8 backdrop-blur">
        <h1 className="text-h2 text-white">Sign in to PettahPro Platform</h1>
        <p className="mt-3 text-small text-white/70">
          Platform administration. This console operates the platform, not tenant
          businesses.
        </p>
        <div className="mt-8">
          <PlatformLoginForm />
        </div>
      </div>
    </div>
  );
}
