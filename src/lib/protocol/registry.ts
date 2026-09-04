import { config } from "@/lib/config";
import { imageForProduct } from "@/lib/market/product-images";
import type { StoreRecord } from "@/lib/store/types";

const TITLE_CAP = 8;

export type RegistrySku = {
  id: string;
  title: string;
  price: string;
  quantity: number;
};

export type RegistryStore = {
  slug: string;
  name: string;
  llmsTxt: string;
  agentCard: string;
  catalog: string;
  reviews: string;
  buyX402: string;
  checkoutStraitsX: string;
  skuCount: number;
  skus: RegistrySku[];
};

export type MarketProduct = {
  id: string;
  title: string;
  description?: string;
  price: string;
  quantity: number;
  storeSlug: string;
  storeName: string;
  merchantDisplayName?: string;
  merchantAddress?: `0x${string}`;
  visaReceiveLabel?: string;
  visaReceiveId?: string;
  imageUrl: string;
};

export function buildRegistryStores(
  stores: StoreRecord[],
  origin: string,
): RegistryStore[] {
  return [...stores]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((store) => {
      const base = `${origin}/s/${store.slug}`;
      return {
        slug: store.slug,
        name: store.name,
        llmsTxt: `${base}/llms.txt`,
        agentCard: `${base}/agent.json`,
        catalog: `${base}/catalog.json`,
        reviews: `${base}/reviews.json`,
        buyX402: `${base}/buy`,
        checkoutStraitsX: `${base}/checkout`,
        skuCount: store.skus.length,
        skus: store.skus.slice(0, TITLE_CAP).map((sku) => ({
          id: sku.id,
          title: sku.title,
          price: sku.price,
          quantity: sku.quantity,
        })),
      };
    });
}

export function renderRegistryJson(stores: StoreRecord[], origin: string) {
  const listed = buildRegistryStores(stores, origin);
  return {
    protocol: "borneo-agentic-storefront",
    version: "1.0",
    description:
      "Borneo network registry. Agents: start here, then open each store llms.txt. Do not scrape HTML.",
    currency: config.tokenSymbol,
    market: `${origin}/market`,
    endpoints: {
      llmsTxt: `${origin}/llms.txt`,
      registry: `${origin}/registry.json`,
    },
    storeCount: listed.length,
    stores: listed,
  };
}

export function renderRootLlmsTxt(stores: StoreRecord[], origin: string) {
  const listed = buildRegistryStores(stores, origin);
  const lines: string[] = [
    `# Borneo — agent storefront network`,
    ``,
    `> Generative discovery for agents on the Agentic Storefront Protocol.`,
    `> Humans browse ${origin}/market. Agents read this file and ${origin}/registry.json.`,
    `> Do not scrape HTML. Do not invent checkout pages.`,
    ``,
    `## How to buy`,
    `1. Pick a store below (or search titles in registry.json).`,
    `2. GET that store's llms.txt and catalog.json.`,
    `3. POST /buy (expect HTTP 402) or StraitsX /checkout.`,
    ``,
    `## Network index (${listed.length} store${listed.length === 1 ? "" : "s"})`,
    ``,
  ];

  if (listed.length === 0) {
    lines.push(`(empty — merchants publish via ${origin}/onboard)`);
  } else {
    for (const store of listed) {
      const titles = store.skus.map((s) => s.title).join("; ");
      lines.push(`### ${store.name}`);
      lines.push(`- Slug: ${store.slug}`);
      lines.push(`- Instructions: ${store.llmsTxt}`);
      lines.push(`- Catalog: ${store.catalog}`);
      lines.push(`- Agent card: ${store.agentCard}`);
      lines.push(
        `- SKUs (${store.skuCount}): ${titles || "(none)"}${store.skuCount > TITLE_CAP ? "…" : ""}`,
      );
      lines.push(``);
    }
  }

  lines.push(`## Machine index`);
  lines.push(`- JSON registry: ${origin}/registry.json`);
  lines.push(`- Human marketplace: ${origin}/market`);
  lines.push(``);
  lines.push(`## Currency`);
  lines.push(`- Token: ${config.tokenSymbol}`);
  lines.push(`- Network docs live on each store llms.txt`);
  lines.push(``);

  return lines.join("\n");
}

export function flattenMarketProducts(stores: StoreRecord[]): MarketProduct[] {
  const products: MarketProduct[] = [];
  for (const store of stores) {
    for (const sku of store.skus) {
      products.push({
        id: sku.id,
        title: sku.title,
        description: sku.description,
        price: sku.price,
        quantity: sku.quantity,
        storeSlug: store.slug,
        storeName: store.name,
        merchantDisplayName: store.merchantDisplayName,
        merchantAddress: store.merchantAddress,
        visaReceiveLabel: store.visaReceive?.accountLabel,
        visaReceiveId: store.visaReceive?.receiveId,
        imageUrl: imageForProduct(sku.title, sku.description, sku.id),
      });
    }
  }
  return products.sort((a, b) => a.title.localeCompare(b.title));
}

export function filterMarketProducts(
  products: MarketProduct[],
  query?: string | null,
): MarketProduct[] {
  const q = query?.trim().toLowerCase();
  if (!q) return products;
  const tokens = q.split(/\s+/).filter((t) => t.length > 1);
  return products.filter((p) => {
    const hay = `${p.title} ${p.description || ""} ${p.id}`.toLowerCase();
    if (hay.includes(q)) return true;
    // Token overlap on product fields only — never match storeSlug
    // (e.g. q="shirt" must not pull every SKU from "hackathon-shirts").
    if (tokens.length === 0) return false;
    return tokens.some((t) => hay.includes(t));
  });
}
