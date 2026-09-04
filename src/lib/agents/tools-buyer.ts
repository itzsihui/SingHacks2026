import { Wallet } from "xrpl";
import {
  XRPLPresignedPaymentPayer,
  type PaymentRequirements,
} from "x402-xrpl";
import { resolveBuyerTarget } from "@/lib/agents/discover";
import { config, explorerTx, toAtomic, toPaymentAmount } from "@/lib/config";
import { emit } from "@/lib/protocol/events";

export type BuyerStep = {
  type: "info" | "http" | "chain" | "error" | "success";
  text: string;
};

export type BuyerReceipt = {
  orderId?: string;
  explorerUrl?: string;
  txHash?: string;
  amount?: string;
  rail?: string;
  status?: string;
  [key: string]: unknown;
};

/** Locked settle quote — no product titles or catalog prose. */
export type PayQuote = {
  storeSlug: string;
  skuId: string;
  price: string;
  merchantAddress?: string;
};

export { extractRequestedProduct } from "@/lib/agents/discover";

/**
 * Deterministic x402 handshake on XRPL Testnet (RLUSD).
 * Prefer a locked quote (slug+skuId+price). Fuzzy message/product matching
 * remains only for legacy demo paths without a quote.
 */
export async function payX402Tool(args: {
  origin: string;
  slug?: string;
  message?: string;
  product?: string;
  quote?: PayQuote;
  buyerUid?: string;
}): Promise<{ steps: BuyerStep[]; receipt?: BuyerReceipt }> {
  const steps: BuyerStep[] = [];
  const quote = args.quote;
  const buyerUid = args.buyerUid?.trim() || undefined;

  const resolved = await resolveBuyerTarget({
    slug: quote?.storeSlug || args.slug,
    skuId: quote?.skuId,
    message: quote ? undefined : args.message,
    product: quote ? undefined : args.product,
  });

  if (!resolved.ok) {
    steps.push({
      type: "info",
      text: quote
        ? `Resolving locked quote /s/${quote.storeSlug} · ${quote.skuId}`
        : args.slug || args.message?.includes("/s/")
          ? "Resolving store"
          : "Searching Borneo network registry (no /s/{slug} in prompt)",
    });
    steps.push({
      type: "error",
      text: resolved.available
        ? `${resolved.reason} Available: ${resolved.available}.`
        : resolved.reason,
    });
    return { steps };
  }

  const { slug, sku, via, merchantAddress } = resolved;
  const base = `${args.origin}/s/${slug}`;
  const expectedPrice = quote?.price || sku.price;
  const expectedPayTo = (quote?.merchantAddress || merchantAddress).trim();

  if (via === "quote") {
    steps.push({
      type: "info",
      text: `Capability lock → /s/${slug} · sku ${sku.id} · ${expectedPrice} ${config.tokenSymbol}`,
    });
  } else if (via === "registry") {
    steps.push({
      type: "info",
      text: `Network registry → matched sku ${sku.id} @ /s/${slug}`,
    });
    emit({
      status: 200,
      method: "GET",
      path: "/registry.json",
      store: slug,
      message: `buyer matched sku ${sku.id}`,
    });
  }

  steps.push({ type: "info", text: `Discovering ${base}/llms.txt` });
  const llms = await fetch(`${base}/llms.txt`);
  steps.push({
    type: "http",
    text: `GET llms.txt → ${llms.status}`,
  });

  steps.push({ type: "info", text: "Loading ACP catalog" });
  const catalogRes = await fetch(`${base}/catalog.json`);
  steps.push({
    type: "http",
    text: `GET catalog.json → ${catalogRes.status} · sku ${sku.id}`,
  });

  const orderId = crypto.randomUUID();
  steps.push({ type: "info", text: `POST ${base}/buy (no payment)` });
  const first = await fetch(`${base}/buy`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      skuId: sku.id,
      quantity: 1,
      orderId,
      buyerUid,
    }),
  });
  const challenge = (await first.json()) as {
    accepts?: PaymentRequirements[];
    error?: string;
  };
  steps.push({
    type: "http",
    text: `HTTP ${first.status} ${first.status === 402 ? "Payment Required" : ""}`,
  });

  if (first.status !== 402) {
    steps.push({ type: "error", text: "Expected 402 challenge" });
    return { steps };
  }

  const accept = challenge.accepts?.[0];
  if (!accept) {
    steps.push({ type: "error", text: "402 missing accepts[]" });
    return { steps };
  }

  if (accept.payTo.trim() !== expectedPayTo) {
    steps.push({
      type: "error",
      text: `Capability check failed: 402 payTo ${accept.payTo} does not match locked merchant ${expectedPayTo}`,
    });
    return { steps };
  }

  let expectedAmount: string;
  let expectedAtomic: string;
  try {
    expectedAmount = toPaymentAmount(expectedPrice);
    expectedAtomic = toAtomic(expectedPrice);
  } catch {
    steps.push({
      type: "error",
      text: `Invalid locked price: ${expectedPrice}`,
    });
    return { steps };
  }

  const offerAtomic = toAtomic(accept.amount);
  if (offerAtomic !== expectedAtomic) {
    steps.push({
      type: "error",
      text: `Capability check failed: 402 amount ${accept.amount} does not match locked price ${expectedPrice} ${config.tokenSymbol} (${expectedAmount})`,
    });
    return { steps };
  }

  steps.push({
    type: "info",
    text: "Capability checks passed: payTo + amount match locked quote",
  });

  if (!config.buyerSeed) {
    emit({
      status: 402,
      method: "POST",
      path: `${base}/buy`,
      store: slug,
      orderId,
      rail: "x402",
      message: "402 unpaid: XRPL_BUYER_SEED missing, cannot sign on XRPL Testnet",
    });
    steps.push({
      type: "error",
      text: `402 is the challenge. Add XRPL_BUYER_SEED + funded ${config.tokenSymbol} (trust line) on XRPL Testnet, then Buy again.`,
    });
    return { steps, receipt: challenge as BuyerReceipt };
  }

  let wallet: Wallet;
  try {
    wallet = Wallet.fromSeed(config.buyerSeed);
  } catch {
    steps.push({ type: "error", text: "Invalid XRPL_BUYER_SEED" });
    return { steps, receipt: challenge as BuyerReceipt };
  }

  steps.push({
    type: "chain",
    text: `Signing ${config.tokenSymbol} Payment ${accept.amount} → ${accept.payTo} on XRPL Testnet (${wallet.classicAddress})`,
  });

  let paymentHeader: string;
  try {
    const payer = new XRPLPresignedPaymentPayer({
      wallet,
      network: config.network === "xrpl:0" || config.network === "xrpl:2"
        ? config.network
        : "xrpl:1",
      wsUrl: config.wsUrl,
      invoiceBinding: "memos",
    });
    const prepared = await payer.preparePayment(accept);
    paymentHeader = prepared.paymentHeader;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "sign failed";
    emit({
      status: 402,
      method: "POST",
      path: `${base}/buy`,
      store: slug,
      orderId,
      rail: "x402",
      message: `402 unsigned: ${reason}`,
    });
    steps.push({ type: "error", text: reason });
    return { steps, receipt: challenge as BuyerReceipt };
  }

  steps.push({ type: "chain", text: "Presigned Payment blob ready" });

  const second = await fetch(`${base}/buy`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "PAYMENT-SIGNATURE": paymentHeader,
    },
    body: JSON.stringify({
      skuId: sku.id,
      quantity: 1,
      orderId,
      buyerUid,
    }),
  });
  const secondText = await second.text();
  let receipt: BuyerReceipt;
  try {
    receipt = JSON.parse(secondText) as BuyerReceipt;
  } catch {
    const snippet = secondText.slice(0, 160).replace(/\s+/g, " ");
    steps.push({
      type: "error",
      text: `HTTP ${second.status} non-JSON from /buy: ${snippet}`,
    });
    return {
      steps,
      receipt: { status: "verify-failed" },
    };
  }
  if (receipt.txHash && !receipt.explorerUrl) {
    receipt.explorerUrl = explorerTx(String(receipt.txHash));
  }
  steps.push({
    type: second.ok ? "success" : "error",
    text: `HTTP ${second.status} ${second.ok ? "receipt unlocked" : JSON.stringify(receipt)}`,
  });
  if (second.ok && receipt.explorerUrl) {
    steps.push({ type: "success", text: receipt.explorerUrl });
  } else if (second.ok && receipt.txHash) {
    steps.push({ type: "success", text: explorerTx(String(receipt.txHash)) });
  }
  return { steps, receipt };
}
