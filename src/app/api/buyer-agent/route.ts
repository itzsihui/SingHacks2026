import { runBuyerAgent } from "@/lib/agents/buyer";
import { config } from "@/lib/config";

export const runtime = "nodejs";

type BuyerAgentBody = {
  message?: string;
  buyerUid?: string;
  quote?: {
    storeSlug?: string;
    skuId?: string;
    price?: string;
    merchantAddress?: string;
  };
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as BuyerAgentBody;
    const origin = config.protocolBaseUrl || new URL(request.url).origin;

    const quote =
      body.quote?.storeSlug && body.quote?.skuId && body.quote?.price
        ? {
            storeSlug: String(body.quote.storeSlug),
            skuId: String(body.quote.skuId),
            price: String(body.quote.price),
            merchantAddress: body.quote.merchantAddress
              ? (String(body.quote.merchantAddress) as `0x${string}`)
              : undefined,
          }
        : undefined;

    const result = await runBuyerAgent({
      origin,
      message: body.message,
      quote,
      buyerUid: body.buyerUid?.trim() || undefined,
    });
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Buyer agent failed";
    return Response.json(
      { steps: [{ type: "error", text: message }], error: message },
      { status: 500 },
    );
  }
}
