import {
  Camera,
  Check,
  FileText,
  MessageCircle,
  Receipt,
  ShieldCheck,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

/**
 * Per-feature mini-UI mockups rendered with pure CSS animations.
 * Each tells a one-glance story of what that feature actually does.
 */
export function FeaturePreview({ id }: { id: string }) {
  switch (id) {
    case "ai-entry":
      return <AiEntryPreview />;
    case "whatsapp":
      return <WhatsAppPreview />;
    case "realtime":
      return <RealtimePreview />;
    case "sl-native":
      return <CompliancePreview />;
    default:
      return null;
  }
}

/* ------------------------------ AI ENTRY ------------------------------ */

function AiEntryPreview() {
  return (
    <PreviewFrame label="Bill capture">
      <div className="relative overflow-hidden rounded-md border-hairline border-border bg-surface-recessed">
        <div className="flex items-center gap-3 border-b-hairline border-border bg-surface-elevated px-4 py-3">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-mint-surface text-mint-dark">
            <Camera className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <p className="text-small font-medium text-charcoal">supplier-bill.jpg</p>
            <p className="text-caption text-text-tertiary">Scanning…</p>
          </div>
          <span className="rounded-full bg-mint-surface px-2 py-0.5 text-micro text-mint-dark">AI</span>
        </div>

        <div className="relative h-24 bg-surface-recessed">
          <div
            aria-hidden
            className="absolute left-3 right-3 h-[2px] bg-mint"
            style={{ animation: "scan-line 2.4s ease-in-out infinite" }}
          />
          <div className="grid h-full grid-cols-5 gap-2 px-3 py-3">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="rounded bg-border" />
            ))}
          </div>
        </div>

        <div className="space-y-2 px-4 py-4">
          <ExtractedRow label="Vendor" value="Perera Traders" delay={0.3} />
          <ExtractedRow label="Date" value="18 / 04 / 2026" delay={0.6} />
          <ExtractedRow label="Amount" value="LKR 48,650.00" delay={0.9} emphasize />
          <ExtractedRow label="VAT (18%)" value="LKR 8,757.00" delay={1.2} />
        </div>
      </div>
    </PreviewFrame>
  );
}

function ExtractedRow({
  label,
  value,
  delay,
  emphasize,
}: {
  label: string;
  value: string;
  delay: number;
  emphasize?: boolean;
}) {
  return (
    <div
      className="flex items-center justify-between animate-fade-up"
      style={{ animationDelay: `${delay}s` }}
    >
      <span className="text-caption uppercase tracking-wide text-text-tertiary">{label}</span>
      <span
        className={`tabular-nums text-small ${emphasize ? "font-medium text-charcoal" : "text-text-primary"}`}
      >
        {value}
      </span>
    </div>
  );
}

/* ------------------------------ WHATSAPP ------------------------------ */

function WhatsAppPreview() {
  return (
    <PreviewFrame label="Customer message">
      <div className="space-y-3">
        <ChatBubble direction="out" delay={0.1}>
          <p className="text-small">Hi Fathima, invoice for this month is ready.</p>
        </ChatBubble>

        <ChatBubble direction="out" delay={0.5}>
          <div className="flex items-center gap-3 rounded-md border-hairline border-border bg-offwhite p-3">
            <div className="grid h-10 w-10 place-items-center rounded-md bg-mint-surface text-mint-dark">
              <Receipt className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <p className="text-small font-medium text-charcoal">INV-2026-0342</p>
              <p className="tabular-nums text-caption text-text-secondary">LKR 48,650 · due 25 Apr</p>
            </div>
            <span className="text-caption font-medium text-mint-dark">Pay →</span>
          </div>
        </ChatBubble>

        <ChatBubble direction="in" delay={1.3}>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-mint-surface">
              <Check className="h-3 w-3 text-mint-dark" />
            </span>
            <p className="text-small">Paid via LankaQR</p>
          </div>
        </ChatBubble>
      </div>
    </PreviewFrame>
  );
}

function ChatBubble({
  children,
  direction,
  delay,
}: {
  children: React.ReactNode;
  direction: "in" | "out";
  delay: number;
}) {
  const isOut = direction === "out";
  return (
    <div
      className={`flex ${isOut ? "justify-end" : "justify-start"} animate-fade-up`}
      style={{ animationDelay: `${delay}s` }}
    >
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2 ${
          isOut
            ? "rounded-br-sm bg-mint-surface text-charcoal"
            : "rounded-bl-sm border-hairline border-border bg-surface-elevated text-charcoal"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

/* ------------------------------ REALTIME ------------------------------ */

function RealtimePreview() {
  return (
    <PreviewFrame label="Today">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Cash" value="LKR 4,82,630" tone="mint" />
        <Stat label="AR 0-30" value="LKR 1,24,500" />
        <Stat label="AP this wk" value="LKR 87,200" />
      </div>

      <div className="mt-4 rounded-md border-hairline border-border bg-surface-recessed p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-caption uppercase tracking-wide text-text-tertiary">Last 7 days</p>
          <span className="inline-flex items-center gap-1 text-caption text-mint-dark">
            <TrendingUp className="h-3 w-3" /> 12%
          </span>
        </div>
        <svg viewBox="0 0 200 52" className="h-14 w-full" aria-hidden>
          <defs>
            <linearGradient id="spark" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#7FB89A" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#7FB89A" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path
            d="M0,38 L28,32 L56,40 L84,22 L112,28 L140,14 L168,20 L200,8 L200,52 L0,52 Z"
            fill="url(#spark)"
          />
          <path
            d="M0,38 L28,32 L56,40 L84,22 L112,28 L140,14 L168,20 L200,8"
            fill="none"
            stroke="#3D6B52"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              strokeDasharray: 420,
              strokeDashoffset: 420,
              animation: "sparkline-draw 1.6s 0.2s ease-out forwards",
            }}
          />
        </svg>
        <style>{`@keyframes sparkline-draw { to { stroke-dashoffset: 0; } }`}</style>
      </div>

      <div className="mt-4 space-y-2">
        <MiniRow title="INV-0342 · Perera Textiles" amount="LKR 45,600" status="Paid" positive delay={0.2} />
        <MiniRow title="INV-0341 · Fathima Importers" amount="LKR 12,900" status="Due 20 Apr" delay={0.5} />
      </div>
    </PreviewFrame>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "mint" }) {
  return (
    <div
      className={`rounded-md p-3 ${
        tone === "mint" ? "bg-mint-surface" : "border-hairline border-border bg-surface-elevated"
      }`}
    >
      <p className="text-caption uppercase tracking-wide text-text-tertiary">{label}</p>
      <p className="tabular-nums mt-1 text-small font-medium text-charcoal">{value}</p>
    </div>
  );
}

function MiniRow({
  title,
  amount,
  status,
  positive,
  delay,
}: {
  title: string;
  amount: string;
  status: string;
  positive?: boolean;
  delay: number;
}) {
  return (
    <div
      className="flex items-center justify-between rounded-md border-hairline border-border bg-surface-elevated px-3 py-2 animate-fade-up"
      style={{ animationDelay: `${delay}s` }}
    >
      <span className="text-caption text-charcoal">{title}</span>
      <span className="flex items-center gap-2">
        <span className="tabular-nums text-caption font-medium text-charcoal">{amount}</span>
        <span className={`text-caption ${positive ? "text-mint-dark" : "text-text-tertiary"}`}>{status}</span>
      </span>
    </div>
  );
}

/* ------------------------------ COMPLIANCE ------------------------------ */

function CompliancePreview() {
  const items: { label: string; sub: string; icon: LucideIcon }[] = [
    { label: "VAT return", sub: "Mar 2026 · ready to file", icon: FileText },
    { label: "WHT certificates", sub: "12 generated", icon: ShieldCheck },
    { label: "EPF C-form", sub: "21 employees · LKR 1,48,200", icon: ShieldCheck },
    { label: "PAYE T-10", sub: "Mar 2026 · LKR 62,400", icon: FileText },
    { label: "Cheque ledger", sub: "3 issued · 1 cleared · 0 bounced", icon: ShieldCheck },
  ];
  return (
    <PreviewFrame label="Compliance this month">
      <ul className="space-y-2.5">
        {items.map((it, i) => {
          const Icon = it.icon;
          return (
            <li
              key={it.label}
              className="flex items-center justify-between rounded-md border-hairline border-border bg-surface-elevated p-3 animate-fade-up"
              style={{ animationDelay: `${0.1 + i * 0.15}s` }}
            >
              <div className="flex items-center gap-3">
                <div className="grid h-8 w-8 place-items-center rounded-md bg-mint-surface text-mint-dark">
                  <Icon className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-small font-medium text-charcoal">{it.label}</p>
                  <p className="text-caption text-text-tertiary">{it.sub}</p>
                </div>
              </div>
              <span
                className="grid h-6 w-6 place-items-center rounded-full bg-mint text-mint-dark"
                style={{ animation: `check-pop 0.5s ${0.4 + i * 0.15}s both` }}
              >
                <Check className="h-3.5 w-3.5" />
              </span>
            </li>
          );
        })}
      </ul>
    </PreviewFrame>
  );
}

/* ------------------------------ frame wrapper ------------------------------ */

function PreviewFrame({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      aria-hidden
      className="relative rounded-card border-hairline border-border bg-surface-elevated p-5 shadow-sm"
    >
      <div className="mb-4 flex items-center justify-between">
        <p className="text-caption uppercase tracking-wide text-text-tertiary">{label}</p>
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-border" />
          <span className="h-2 w-2 rounded-full bg-border" />
          <span className="h-2 w-2 rounded-full bg-border" />
        </div>
      </div>
      {children}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-6 -top-6 -z-10 h-40 w-40 rounded-full bg-mint-surface/70 blur-2xl animate-float"
      />
    </div>
  );
}
