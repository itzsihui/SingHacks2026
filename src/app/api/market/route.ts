import {
  filterMarketProducts,
  flattenMarketProducts,
} from "@/lib/protocol/registry";
import { repo } from "@/lib/store/repo";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q");
  const stores = await repo.listStores();
  const products = filterMarketProducts(flattenMarketProducts(stores), q);
  return Response.json(
    {
      storeCount: stores.length,
      productCount: products.length,
      query: q || null,
      stores: stores.map((s) => ({
        slug: s.slug,
        name: s.name,
        skuCount: s.skus.length,
        merchantDisplayName: s.merchantDisplayName,
        merchantAddress: s.merchantAddress,
        visaReceive: s.visaReceive,
      })),
      products,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
