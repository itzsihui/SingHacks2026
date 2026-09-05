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

  const listed = marketStores(await repo.listStores());
  const origin = originFromRequest(request);
  // Support repeated q=shirt&q=tee — one embed batch for multi-noun hunts
  const queries = url.searchParams.getAll("q").map((s) => s.trim()).filter(Boolean);
  const qList = queries.length ? queries : q ? [q] : [];
  if (qList.length === 0) {
    return Response.json(
      {
        error: "missing_query",
        hint: "GET /api/search?q=linen+shirt+for+humid+weather",
      },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  const result = await semanticSearchMarket({
    products: flattenMarketProducts(listed),
    query: qList.join(" · "),
    queries: qList,
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
