import { originFromRequest } from "@/lib/protocol/llms-txt";
import { flattenMarketProducts } from "@/lib/protocol/registry";
import { semanticSearchMarket } from "@/lib/protocol/semantic-search";
import { repo } from "@/lib/store/repo";
import type { StoreRecord } from "@/lib/store/types";

export const runtime = "nodejs";

function marketStores(stores: StoreRecord[]) {
  return stores.filter((s) => s.listOnMarket !== false);
}

/**
 * Agent-facing semantic search.
 * GET /api/search?q=breathable+shirt+for+humid+weather&limit=8
 *
 * Returns ranked product hits (not the registry). Falls back to keyword
 * when embeddings are unavailable.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() || "";
  const limitRaw = Number(url.searchParams.get("limit") || "8");
  const limit = Number.isFinite(limitRaw) ? limitRaw : 8;

  if (!q) {
    return Response.json(
      {
        error: "missing_query",
        hint: "GET /api/search?q=linen+shirt+for+humid+weather",
      },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  const listed = marketStores(await repo.listStores());
  const origin = originFromRequest(request);
  const result = await semanticSearchMarket({
    products: flattenMarketProducts(listed),
    query: q,
    origin,
    limit,
  });

  return Response.json(
    {
      protocol: "borneo-agentic-storefront",
      ...result,
      storeCount: listed.length,
      endpoints: {
        registry: `${origin}/registry.json`,
        market: `${origin}/api/market`,
        search: `${origin}/api/search`,
      },
    },
    { headers: { "cache-control": "no-store" } },
  );
}
