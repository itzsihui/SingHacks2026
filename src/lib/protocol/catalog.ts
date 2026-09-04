import { config } from "@/lib/config";
import type { StoreRecord } from "@/lib/store/types";

export function renderCatalog(store: StoreRecord, origin: string) {
  return {
    protocol: "agentic-commerce-protocol",
    version: "2026-04-17-subset",
    merchant: {
      id: store.slug,
      name: store.name,
      url: `${origin}/s/${store.slug}/llms.txt`,
    },
    currency: config.tokenSymbol,
    network: config.network,
    rails: ["x402", "straitsx-virtual-card"],
    products: store.skus.map((sku) => ({
      id: sku.id,
      title: sku.title,
      description: { type: "plain", content: sku.description },
      availability: sku.quantity > 0 ? "in_stock" : "out_of_stock",
      variants: [
        {
          id: sku.id,
          title: sku.title,
          quantity: sku.quantity,
          price: `${sku.price} ${config.tokenSymbol}`,
          amount_atomic: String(
            Math.round(Number(sku.price) * 10 ** config.tokenDecimals),
          ),
        },
      ],
    })),
  };
}
