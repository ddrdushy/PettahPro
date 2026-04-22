/**
 * Wraps a `@react-pdf/renderer` Buffer into a Next.js Response suitable
 * for an inline PDF download.
 *
 * Node's `Buffer` is a `Uint8Array` at runtime, but TypeScript's strict
 * DOM-lib types don't accept `Buffer` as `BodyInit`. Every PDF route in
 * the app used to write:
 *
 *   return new Response(pdf, { ... });
 *
 * …which typechecked with a TS2345 error on each call site (9 routes,
 * all with the same error — see `_status.md` §2 sweep #2). This helper
 * zero-copy-rewraps the Buffer's underlying ArrayBuffer into a plain
 * Uint8Array, which *is* a valid BodyInit, and centralises the headers
 * we want on every PDF response.
 *
 * Behaviour is identical to the inlined version: `Cache-Control: private,
 * no-store` (these docs have tenant-sensitive data, never cache them),
 * `Content-Disposition: inline` (browser-viewable, download-on-click), and
 * `Content-Type: application/pdf`.
 */
export function pdfResponse(pdf: Buffer, filename: string): Response {
  // Detach the bytes into a plain ArrayBuffer. Both `Buffer` and
  // `Uint8Array<ArrayBufferLike>` fail to satisfy `BodyInit` under
  // TypeScript 5.7+'s tightened dom-lib types, but a plain `ArrayBuffer`
  // does. `.slice()` copies the range into a fresh, right-sized buffer
  // — PDFs are small (tens of KB) and this lives in one place, so the
  // extra copy is worth the type safety.
  const body = pdf.buffer.slice(
    pdf.byteOffset,
    pdf.byteOffset + pdf.byteLength,
  ) as ArrayBuffer;
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
