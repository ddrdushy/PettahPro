import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { formatLKR } from "@/lib/format";
import type { BundleComponent, Item } from "@/lib/api";
import { BundleComponentsEditor } from "./bundle-components-editor";

export const metadata: Metadata = { title: "Item" };

async function fetchItem(
  id: string,
): Promise<{ item: Item; components: BundleComponent[]; allItems: Item[] } | null> {
  const base = process.env.INTERNAL_API_URL ?? "http://api:4000";
  const headers = { cookie: cookies().toString() };
  const [itemRes, allRes] = await Promise.all([
    fetch(`${base}/items/${id}`, { headers, cache: "no-store" }),
    fetch(`${base}/items`, { headers, cache: "no-store" }),
  ]);
  if (itemRes.status === 404) return null;
  if (!itemRes.ok) return null;
  const { item, components } = (await itemRes.json()) as {
    item: Item;
    components: BundleComponent[];
  };
  const allItems = allRes.ok
    ? ((await allRes.json()) as { items: Item[] }).items
    : [];
  return { item, components, allItems };
}

export default async function ItemDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const data = await fetchItem(params.id);
  if (!data) notFound();
  const { item, components, allItems } = data;

  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link href="/app/items" className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to items
        </Link>
      </div>

      <PageHeader
        eyebrow={
          item.itemType === "bundle"
            ? "Bundle"
            : item.itemType === "service"
              ? "Service"
              : "Product"
        }
        title={item.name}
        description={item.sku ? `SKU ${item.sku}` : undefined}
      />

      <section className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat
          label="Sell price"
          value={item.sellPriceCents > 0 ? formatLKR(item.sellPriceCents) : "—"}
        />
        <Stat
          label="Buy price"
          value={item.buyPriceCents > 0 ? formatLKR(item.buyPriceCents) : "—"}
        />
        <Stat label="Unit" value={item.unit} />
        <Stat
          label="Tracks stock"
          value={item.trackInventory ? "Yes" : "No"}
        />
      </section>

      {item.itemType === "bundle" && (
        <section className="mt-10">
          <h2 className="text-body font-medium text-charcoal">Components</h2>
          <p className="mt-1 text-caption text-text-tertiary">
            Each unit of this bundle consumes the listed quantities from its
            components at invoice post time. Bundles never carry stock
            themselves.
          </p>
          <BundleComponentsEditor
            itemId={item.id}
            initial={components}
            allItems={allItems.filter(
              (i) => i.id !== item.id && i.itemType !== "bundle" && i.isActive,
            )}
          />
        </section>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border-hairline border-border bg-surface-elevated p-3">
      <p className="text-caption text-text-tertiary">{label}</p>
      <p className="mt-1 text-body font-medium text-charcoal">{value}</p>
    </div>
  );
}
