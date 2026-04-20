import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        charcoal: "#1A1A1A",
        mint: {
          DEFAULT: "#7FB89A",
          dark: "#3D6B52",
          surface: "#E8EDE9",
        },
        offwhite: "#FAFAF9",
        "text-primary": "#1A1A1A",
        "text-secondary": "#5F5E5A",
        "text-tertiary": "#888780",
        border: {
          DEFAULT: "#E5E5E3",
          emphasis: "#D3D1C7",
        },
        surface: {
          elevated: "#FFFFFF",
          recessed: "#F1EFE8",
        },
        warning: {
          DEFAULT: "#B47A15",
          bg: "#FAF0D9",
          accent: "#E3A72F",
        },
        danger: {
          DEFAULT: "#A53C2D",
          bg: "#F7E7E4",
          accent: "#C44536",
        },
      },
      fontFamily: {
        sans: [
          "var(--font-inter)",
          "Inter",
          "Noto Sans Sinhala",
          "Noto Sans Tamil",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
      },
      fontSize: {
        display: ["2.75rem", { lineHeight: "1.15", fontWeight: "500" }],
        h1: ["2rem", { lineHeight: "1.25", fontWeight: "500" }],
        h2: ["1.375rem", { lineHeight: "1.35", fontWeight: "500" }],
        h3: ["1.125rem", { lineHeight: "1.4", fontWeight: "500" }],
        "body-lg": ["1rem", { lineHeight: "1.6", fontWeight: "400" }],
        body: ["0.875rem", { lineHeight: "1.5", fontWeight: "400" }],
        small: ["0.8125rem", { lineHeight: "1.45", fontWeight: "400" }],
        caption: ["0.75rem", { lineHeight: "1.4", fontWeight: "400" }],
        micro: ["0.6875rem", { lineHeight: "1.3", fontWeight: "500" }],
      },
      borderWidth: {
        hairline: "0.5px",
      },
      borderRadius: {
        card: "12px",
      },
      spacing: {
        "section-y": "5rem",
      },
      maxWidth: {
        content: "1200px",
      },
    },
  },
  plugins: [],
} satisfies Config;
