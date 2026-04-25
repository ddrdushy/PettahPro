"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Fades and translates its children into view once they intersect the viewport.
 * Uses IntersectionObserver — no animation libs, no layout shift, respects
 * prefers-reduced-motion via a CSS override.
 */
export function Reveal({
  children,
  as: Tag = "div",
  delay = 0,
  className,
}: {
  children: ReactNode;
  // Narrowed from `keyof JSX.IntrinsicElements` because the full union is too
  // complex for TS to represent in the JSX attribute set ("union too complex
  // to represent" build error). Only `div` (default) and `li` are used today;
  // extend this list if you need another tag.
  as?: "div" | "li" | "section" | "article" | "span";
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" },
    );

    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag
      ref={ref as never}
      className={`reveal ${className ?? ""}`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  );
}
