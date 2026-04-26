import { Image } from "@react-pdf/renderer";

// Shared logo image for the tenant header on every PDF (gaps M9
// follow-up). All renderers use the same `<View style={tenantBlock}>`
// → `<Text style={tenantName}>` shape, so we just slot a sized image
// above the name when a logo data URL is present.
//
// Style is intentionally compact and hard-coded — react-pdf doesn't
// have CSS classes, every doc renderer has its own StyleSheet, and the
// logo is *always* sized the same regardless of doc type. Keeping
// this as a one-liner component avoids 12 near-identical Image blocks.

const LOGO_STYLE = {
  width: 120,
  // Auto-height so logos with varying aspect ratios stay un-squished;
  // react-pdf computes the height from the source bitmap when only
  // width is set.
  marginBottom: 8,
} as const;

export function PdfLogoBlock({
  logoDataUrl,
}: {
  logoDataUrl?: string | null;
}) {
  if (!logoDataUrl) return null;
  // eslint-disable-next-line jsx-a11y/alt-text
  return <Image src={logoDataUrl} style={LOGO_STYLE} />;
}
