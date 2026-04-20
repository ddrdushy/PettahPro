import type { Metadata } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://pettahpro.lk"),
  title: {
    default: "PettahPro — Accounting for how Sri Lanka actually does business",
    template: "%s · PettahPro",
  },
  description:
    "Cloud accounting for Sri Lankan SMEs. Replace BUSY and Tally with a cloud-native, mobile-ready, AI-assisted platform built for SL compliance. 30-day free trial. Migration included.",
  keywords: [
    "cloud accounting Sri Lanka",
    "BUSY alternative",
    "Tally replacement",
    "SL VAT software",
    "Sri Lanka SME accounting",
    "PettahPro",
  ],
  authors: [{ name: "PettahPro" }],
  creator: "PettahPro",
  openGraph: {
    type: "website",
    locale: "en_LK",
    url: "https://pettahpro.lk",
    siteName: "PettahPro",
    title: "PettahPro — Accounting for how Sri Lanka actually does business",
    description:
      "Cloud accounting for Sri Lankan SMEs. Replace BUSY and Tally. 30-day free trial. Migration included.",
  },
  twitter: {
    card: "summary_large_image",
    title: "PettahPro — Accounting for how Sri Lanka actually does business",
    description:
      "Cloud accounting for Sri Lankan SMEs. Replace BUSY and Tally. 30-day free trial.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="font-sans">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-charcoal focus:px-4 focus:py-2 focus:text-offwhite"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
