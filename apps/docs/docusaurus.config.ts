import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";
import { themes as prismThemes } from "prism-react-renderer";

// Docusaurus 3 config — single-instance, docs-only site (no blog).
// Lives at apps/docs in the monorepo so writers can ship docs in the
// same PR as the feature it documents. Built output goes to
// apps/docs/build; deployment target is left to whichever host the
// team picks (GitHub Pages / Netlify / Vercel / self-hosted).
//
// Brand tokens come from apps/web's brand-kit.md §5 (mint + charcoal)
// — see src/css/custom.css for the Infima variable overrides.

const config: Config = {
  title: "PettahPro Docs",
  tagline: "Cloud accounting and business operations for Sri Lankan SMEs",
  favicon: "img/favicon.svg",

  // Override at deploy time via DOCS_URL env when hosting under a real
  // domain; defaults to GitHub Pages-friendly project URL.
  url: process.env.DOCS_URL ?? "https://docs.pettahpro.lk",
  baseUrl: "/",

  organizationName: "ddrdushy",
  projectName: "PettahPro",
  trailingSlash: false,

  // Don't fail builds on broken cross-page links during initial
  // bootstrap — flip these to "throw" once the wiki has critical mass
  // and review pressure on link integrity is real.
  onBrokenLinks: "warn",
  onBrokenMarkdownLinks: "warn",

  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  markdown: {
    mermaid: true,
  },

  themes: ["@docusaurus/theme-mermaid"],

  presets: [
    [
      "classic",
      {
        docs: {
          // Docs route at the site root — no /docs/ prefix because
          // the whole site is documentation.
          routeBasePath: "/",
          sidebarPath: "./sidebars.ts",
          editUrl:
            "https://github.com/ddrdushy/PettahPro/edit/main/apps/docs/",
          showLastUpdateTime: true,
          showLastUpdateAuthor: false,
        },
        // Blog disabled — this is reference documentation, not a
        // changelog feed. Release notes belong on GitHub Releases.
        blog: false,
        theme: {
          customCss: "./src/css/custom.css",
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {
      defaultMode: "light",
      respectPrefersColorScheme: true,
    },
    image: "img/og-card.png",
    navbar: {
      title: "PettahPro",
      logo: {
        alt: "PettahPro",
        src: "img/logo.svg",
      },
      items: [
        {
          type: "docSidebar",
          sidebarId: "main",
          position: "left",
          label: "Docs",
        },
        {
          href: "https://github.com/ddrdushy/PettahPro",
          label: "GitHub",
          position: "right",
        },
      ],
    },
    footer: {
      style: "light",
      links: [
        {
          title: "Docs",
          items: [
            { label: "Getting started", to: "/getting-started" },
            { label: "Glossary", to: "/concepts/glossary" },
            {
              label: "All modules",
              to: "/",
            },
          ],
        },
        {
          title: "Project",
          items: [
            {
              label: "GitHub",
              href: "https://github.com/ddrdushy/PettahPro",
            },
            {
              label: "Issues",
              href: "https://github.com/ddrdushy/PettahPro/issues",
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} PettahPro. Built for Sri Lankan businesses.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ["bash", "sql", "json", "typescript"],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
