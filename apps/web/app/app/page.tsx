import Link from "next/link";
import { ArrowRight, CircleDollarSign, Receipt, Users, Package, FileText, Wallet } from "lucide-react";

export default function AppHomePage() {
  return (
    <main className="container-p py-12">
      <div className="flex flex-col gap-2">
        <span className="eyebrow">Welcome</span>
        <h1 className="text-h1 text-charcoal md:text-display">Let's set your books up.</h1>
        <p className="max-w-2xl text-body-lg text-text-secondary">
          Your trial is live. Start with your first invoice, bring stock in, or bring your accountant aboard — whatever gets you unstuck.
        </p>
      </div>

      <section className="mt-12">
        <h2 className="text-h2 text-charcoal">Quick starts</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <ActionCard
            icon={<Receipt className="h-5 w-5" />}
            title="Send your first invoice"
            body="Add a customer, add lines, send it. PettahPro handles VAT and posting for you."
            href="#"
          />
          <ActionCard
            icon={<Package className="h-5 w-5" />}
            title="Add your items"
            body="Stock items, services, or both. Import from CSV or add one by one."
            href="#"
          />
          <ActionCard
            icon={<Users className="h-5 w-5" />}
            title="Invite your team"
            body="Cashiers, accountants, sales staff — each with their own access level."
            href="#"
          />
          <ActionCard
            icon={<CircleDollarSign className="h-5 w-5" />}
            title="Record your first bill"
            body="Snap a supplier invoice with your phone. AI reads it — you review and post."
            href="#"
          />
          <ActionCard
            icon={<FileText className="h-5 w-5" />}
            title="Set up your chart of accounts"
            body="Start from an SL-appropriate template, or build your own."
            href="#"
          />
          <ActionCard
            icon={<Wallet className="h-5 w-5" />}
            title="Connect your bank"
            body="Upload a statement to reconcile. Live feeds coming in Phase 2."
            href="#"
          />
        </div>
      </section>

      <section className="mt-16 rounded-card border-hairline border-border bg-surface-elevated p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-caption uppercase tracking-wide text-text-tertiary">Trial status</p>
            <p className="mt-1 text-h3 text-charcoal">30 days of PettahPro · full access</p>
            <p className="mt-1 text-small text-text-secondary">No card on file. Cancel anytime.</p>
          </div>
          <Link href="/pricing" className="btn-secondary">
            See pricing
          </Link>
        </div>
      </section>
    </main>
  );
}

function ActionCard({
  icon,
  title,
  body,
  href,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group flex h-full flex-col justify-between rounded-card border-hairline border-border bg-surface-elevated p-6 transition-all duration-300 hover:-translate-y-0.5 hover:border-charcoal hover:shadow-md"
    >
      <div>
        <div className="grid h-10 w-10 place-items-center rounded-md bg-mint-surface text-mint-dark">
          {icon}
        </div>
        <h3 className="mt-4 text-h3 text-charcoal">{title}</h3>
        <p className="mt-2 text-small text-text-secondary">{body}</p>
      </div>
      <span className="mt-6 inline-flex items-center gap-1 text-small font-medium text-charcoal opacity-60 transition group-hover:gap-2 group-hover:opacity-100">
        Start
        <ArrowRight className="h-3.5 w-3.5" aria-hidden />
      </span>
    </Link>
  );
}
