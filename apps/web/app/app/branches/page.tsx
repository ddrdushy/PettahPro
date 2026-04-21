import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { Building2, MapPin, Phone, Plus, Star } from "lucide-react";
import type { Branch } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";

export const metadata: Metadata = { title: "Branches" };

async function fetchBranches(): Promise<Branch[]> {
  const res = await fetch(`${process.env.INTERNAL_API_URL ?? "http://api:4000"}/branches`, {
    headers: { cookie: cookies().toString() },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { branches: Branch[] };
  return data.branches;
}

export default async function BranchesPage() {
  const branches = await fetchBranches();

  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="Settings"
        title="Branches"
        description="Locations where you do business — shops, warehouses, service centres. Every invoice, bill, and employee can be tagged to a branch."
        action={
          <Link href="/app/branches/new" className="btn-primary">
            <Plus className="h-4 w-4" aria-hidden />
            New branch
          </Link>
        }
      />

      {branches.length === 0 ? (
        <div className="mt-8 rounded-card border-hairline border-border bg-surface-elevated p-10 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-mint-surface text-mint-dark">
            <Building2 className="h-5 w-5" />
          </div>
          <p className="text-body text-charcoal">No branches yet.</p>
          <p className="mt-1 text-small text-text-secondary">Add at least one so transactions can be tagged to where they happened.</p>
          <Link href="/app/branches/new" className="btn-primary mt-4 inline-flex">
            <Plus className="h-4 w-4" aria-hidden />
            New branch
          </Link>
        </div>
      ) : (
        <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {branches.map((b) => (
            <Link
              key={b.id}
              href={`/app/branches/${b.id}`}
              className="rounded-card border-hairline border-border bg-surface-elevated p-5 transition-all hover:-translate-y-0.5 hover:border-charcoal hover:shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="tabular-nums text-caption text-text-tertiary">{b.code}</p>
                  <p className="mt-1 text-h3 text-charcoal">{b.name}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {b.isHeadOffice && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-mint-surface px-2 py-0.5 text-caption font-medium text-mint-dark">
                      <Star className="h-3 w-3" aria-hidden />
                      Head office
                    </span>
                  )}
                  {!b.isActive && (
                    <span className="rounded-full bg-surface-recessed px-2 py-0.5 text-caption font-medium text-text-secondary">
                      Inactive
                    </span>
                  )}
                </div>
              </div>
              {(b.addressLine1 || b.city) && (
                <div className="mt-3 flex items-start gap-2 text-small text-text-secondary">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 flex-none text-text-tertiary" aria-hidden />
                  <div>
                    {b.addressLine1 && <p>{b.addressLine1}</p>}
                    {b.addressLine2 && <p>{b.addressLine2}</p>}
                    {(b.city || b.postalCode) && (
                      <p>
                        {b.city}
                        {b.postalCode ? ` ${b.postalCode}` : ""}
                      </p>
                    )}
                  </div>
                </div>
              )}
              {b.phone && (
                <div className="mt-2 flex items-center gap-2 text-small text-text-secondary">
                  <Phone className="h-3.5 w-3.5 text-text-tertiary" aria-hidden />
                  <span className="tabular-nums">{b.phone}</span>
                </div>
              )}
            </Link>
          ))}
        </section>
      )}
    </main>
  );
}
