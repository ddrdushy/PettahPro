import Link from "next/link";
import { ArrowRight } from "lucide-react";

export function TrustBar() {
  return (
    <div className="border-y-hairline border-border bg-surface-recessed">
      <div className="container-p flex flex-wrap items-center justify-center gap-4 py-5 text-small text-text-secondary">
        <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-mint-dark" aria-hidden />
        <span>
          Now in private beta — trusted SL businesses welcome.
        </span>
        <Link href="/beta" className="btn-link text-small">
          Request early access
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>
    </div>
  );
}
