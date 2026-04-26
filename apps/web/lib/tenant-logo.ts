// Tenant logo loader for PDF renderers (gaps M9 follow-up).
//
// react-pdf's <Image> can take a data URL or a Buffer. We use a data
// URL because it composes through the existing renderer prop
// signature (string | null) and the bytes survive the JSX → react-pdf
// round-trip without any stream plumbing. Logos are <2 MB by policy
// (settings/logo.ts) so the base64 inflation is negligible.
//
// Server-side only — runs inside Next.js route handlers that already
// hold the user's session cookie. We don't expose a public version of
// this; PDFs are rendered server-side, the data URL never leaves the
// server.

const INTERNAL_API = process.env.INTERNAL_API_URL ?? "http://api:4000";

const CONTENT_TYPE_DEFAULT = "image/png";

/**
 * Fetch the tenant's logo from the API and turn it into a `data:`
 * URL ready to drop into a react-pdf `<Image src={...} />`.
 *
 * Always best-effort: any failure (no logo configured, MinIO down,
 * permission glitch) returns `null` and the renderer falls back to
 * the text-only header. PDFs are user-visible artefacts; we'd rather
 * print without a logo than 500 the route.
 *
 * Path is configurable so portal-realm callers can fetch
 * `/portal/tenant-logo` (portal-session-scoped) instead of
 * `/settings/logo` (admin-session-scoped).
 */
export async function fetchTenantLogoDataUrl(
  cookieHeader: string,
  path: string = "/settings/logo",
): Promise<string | null> {
  try {
    const res = await fetch(`${INTERNAL_API}${path}`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const contentType =
      res.headers.get("content-type")?.split(";")[0]?.trim() ??
      CONTENT_TYPE_DEFAULT;
    const arrayBuffer = await res.arrayBuffer();
    if (arrayBuffer.byteLength === 0) return null;
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    return `data:${contentType};base64,${base64}`;
  } catch {
    return null;
  }
}
