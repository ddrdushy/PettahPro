import Link from "next/link";
import {
  ShieldCheck,
  Lock,
  Server,
  FileCheck,
  UserCheck,
  Globe,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import { trust } from "@/lib/content";

const icons: Record<string, LucideIcon> = {
  ShieldCheck,
  Lock,
  Server,
  FileCheck,
  UserCheck,
  Globe,
};

export function TrustSecurity() {
  return (
    <section className="section">
      <div className="container-p">
        <div className="max-w-2xl">
          <span className="eyebrow">Trust &amp; security</span>
          <h2 className="mt-4 text-h1 text-charcoal">Built to keep your books safe.</h2>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {trust.map((t) => {
            const Icon = icons[t.icon] ?? ShieldCheck;
            return (
              <div
                key={t.label}
                className="flex items-start gap-4 rounded-card border-hairline border-border bg-surface-elevated p-5"
              >
                <div className="grid h-10 w-10 flex-none place-items-center rounded-md bg-mint-surface text-mint-dark">
                  <Icon className="h-5 w-5" aria-hidden />
                </div>
                <div>
                  <p className="text-body font-medium text-charcoal">{t.label}</p>
                  <p className="mt-1 text-small text-text-secondary">{t.body}</p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-8">
          <Link href="/security" className="btn-link">
            Read the full security brief
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </div>
    </section>
  );
}
