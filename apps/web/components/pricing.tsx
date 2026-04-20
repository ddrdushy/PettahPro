"use client";

import { useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { pricingPlans } from "@/lib/content";

export function Pricing() {
  const [yearly, setYearly] = useState(false);

  return (
    <section id="pricing" className="section">
      <div className="container-p">
        <div className="mx-auto max-w-2xl text-center">
          <span className="eyebrow">Pricing</span>
          <h2 className="mt-4 text-h1 text-charcoal">Simple LKR pricing. No surprises.</h2>
          <p className="mt-4 text-body-lg text-text-secondary">
            All plans include 30-day free trial. No credit card. Migration from CSV and Excel is always free.
          </p>

          <div
            className="mx-auto mt-8 inline-flex rounded-full border-hairline border-border bg-surface-elevated p-1"
            role="tablist"
            aria-label="Billing period"
          >
            <button
              type="button"
              role="tab"
              aria-selected={!yearly}
              onClick={() => setYearly(false)}
              className={`rounded-full px-4 py-1.5 text-small transition ${
                !yearly ? "bg-charcoal text-offwhite" : "text-text-secondary"
              }`}
            >
              Monthly
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={yearly}
              onClick={() => setYearly(true)}
              className={`rounded-full px-4 py-1.5 text-small transition ${
                yearly ? "bg-charcoal text-offwhite" : "text-text-secondary"
              }`}
            >
              Yearly <span className={yearly ? "text-mint" : "text-mint-dark"}>· save 20%</span>
            </button>
          </div>
        </div>

        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {pricingPlans.map((plan) => (
            <article
              key={plan.name}
              className={`relative flex flex-col rounded-card border-hairline p-7 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg ${
                plan.highlight
                  ? "border-charcoal bg-surface-elevated shadow-md"
                  : "border-border bg-surface-elevated hover:border-charcoal"
              }`}
            >
              {plan.highlight && (
                <span className="absolute -top-3 right-6 rounded-full bg-mint px-3 py-0.5 text-micro uppercase tracking-wide text-mint-dark">
                  Most popular
                </span>
              )}
              <h3 className="text-h3 text-charcoal">{plan.name}</h3>
              <p className="mt-1 text-small text-text-tertiary">{plan.tagline}</p>
              <p className="tabular-nums mt-6 text-h1 text-charcoal">
                {yearly ? plan.yearly : plan.monthly}
                <span className="text-body text-text-tertiary">
                  {" "}
                  /{yearly ? "yr" : "mo"}
                </span>
              </p>
              <ul className="mt-6 flex-1 space-y-2.5">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-small text-text-primary">
                    <Check className="mt-[2px] h-4 w-4 flex-none text-mint-dark" aria-hidden />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-8">
                <Link
                  href="https://app.pettahpro.lk/signup"
                  className={plan.highlight ? "btn-primary w-full" : "btn-secondary w-full"}
                >
                  {plan.cta}
                </Link>
              </div>
            </article>
          ))}
        </div>

        <dl className="mx-auto mt-12 grid max-w-3xl gap-6 text-small text-text-secondary sm:grid-cols-3">
          <div>
            <dt className="font-medium text-charcoal">Can I change plans later?</dt>
            <dd className="mt-1">Yes, anytime. Changes apply from the next billing cycle.</dd>
          </div>
          <div>
            <dt className="font-medium text-charcoal">What if I hit my plan's limits?</dt>
            <dd className="mt-1">We alert you before you do. Upgrade when ready — no surprise charges.</dd>
          </div>
          <div>
            <dt className="font-medium text-charcoal">Is there a setup fee?</dt>
            <dd className="mt-1">No. Self-serve migration is free; Assisted migration is a one-time fee.</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
