import { emit } from "@/lib/protocol/events";
import { originFromRequest } from "@/lib/protocol/llms-txt";
import { renderRegistryJson } from "@/lib/protocol/registry";
import { repo } from "@/lib/store/repo";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const stores = await repo.listStores();
  const origin = originFromRequest(request);
  const body = renderRegistryJson(stores, origin);
  emit({
    status: 200,
    method: "GET",
    path: "/registry.json",
    message: `registry · ${stores.length} store(s)`,
  });
  return Response.json(body, {
    headers: { "cache-control": "no-store" },
  });
}
