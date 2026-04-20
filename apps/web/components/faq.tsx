import { faqs } from "@/lib/content";

export function Faq() {
  return (
    <section className="section bg-surface-recessed">
      <div className="container-p grid gap-12 md:grid-cols-[1fr_2fr]">
        <div>
          <span className="eyebrow">FAQ</span>
          <h2 className="mt-4 text-h1 text-charcoal">Questions people actually ask.</h2>
          <p className="mt-4 text-body text-text-secondary">
            Can't find yours? Email{" "}
            <a href="mailto:hello@pettahpro.lk" className="text-charcoal underline">
              hello@pettahpro.lk
            </a>{" "}
            and we'll reply within a business day.
          </p>
        </div>

        <div className="divide-y-hairline divide-border rounded-card border-hairline border-border bg-surface-elevated">
          {faqs.map((f) => (
            <details key={f.q} className="group px-6">
              <summary className="flex cursor-pointer list-none items-center justify-between py-5 text-body font-medium text-charcoal">
                <span>{f.q}</span>
                <span
                  aria-hidden
                  className="ml-4 grid h-6 w-6 flex-none place-items-center rounded-full border-hairline border-border text-text-secondary transition group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <div className="pb-5 pr-8 text-body text-text-secondary">{f.a}</div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
