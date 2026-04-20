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
import { Reveal } from "@/components/reveal";

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
        <Reveal className="max-w-2xl">
          <span className="eyebrow">Trust &amp; security</span>
          <h2 className="mt-4 text-h1 text-charcoal">Built to keep your books safe.</h2>
        </Reveal>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {trust.map((t, i) => {
            const Icon = icons[t.icon] ?? ShieldCheck;
            return (
              <Reveal key={t.label} delay={i * 80}>
                <div className="flex h-full items-start gap-4 rounded-card border-hairline border-border bg-surface-elevated p-5 transition-all duration-300 hover:-translate-y-0.5 hover:border-charcoal hover:shadow-sm">
                  <div className="grid h-10 w-10 flex-none place-items-center rounded-md bg-mint-surface text-mint-dark">
                    <Icon className="h-5 w-5" aria-hidden />
                  </div>
                  <div>
                    <p className="text-body font-medium text-charcoal">{t.label}</p>
                    <p className="mt-1 text-small text-text-secondary">{t.body}</p>
                  </div>
                </div>
              </Reveal>
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
