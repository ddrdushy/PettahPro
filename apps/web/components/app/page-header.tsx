import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 border-b-hairline border-border pb-6 md:flex-row md:items-end md:justify-between">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1 className={`text-h1 text-charcoal ${eyebrow ? "mt-3" : ""}`}>{title}</h1>
        {description && (
          <p className="mt-2 max-w-2xl text-body text-text-secondary">{description}</p>
        )}
      </div>
      {action && <div className="flex flex-none gap-2">{action}</div>}
    </header>
  );
}
