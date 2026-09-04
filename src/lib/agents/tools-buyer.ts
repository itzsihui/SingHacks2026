import {
  createWalletClient,
  http,
  publicActions,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { resolveBuyerTarget } from "@/lib/agents/discover";
import { config, explorerTx, toAtomic } from "@/lib/config";
import { emit } from "@/lib/protocol/events";

const erc20 = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
]);

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
  merchantAddress?: `0x${string}`;
};

export { extractRequestedProduct } from "@/lib/agents/discover";

/**
 * Deterministic x402 handshake.
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
  const expectedPayTo = (
    quote?.merchantAddress || merchantAddress
  ).toLowerCase() as `0x${string}`;

  if (via === "quote") {
    steps.push({
      type: "info",
      text: `Capability lock → /s/${slug} · sku ${sku.id} · ${expectedPrice} USDC`,
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

  // Discovery probes — status only; never echo catalog / llms body (injection surface)
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
    accepts?: Array<{
      maxAmountRequired: string;
      payTo: `0x${string}`;
    }>;
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

  // Capability checks: 402 offer must match the locked quote
  const offerPayTo = accept.payTo.toLowerCase();
  if (offerPayTo !== expectedPayTo) {
    steps.push({
      type: "error",
      text: `Capability check failed: 402 payTo ${accept.payTo} does not match locked merchant ${expectedPayTo}`,
    });
    return { steps };
  }

  let expectedAtomic: string;
  try {
    expectedAtomic = toAtomic(expectedPrice);
  } catch {
    steps.push({
      type: "error",
      text: `Invalid locked price: ${expectedPrice}`,
    });
    return { steps };
  }

  if (accept.maxAmountRequired !== expectedAtomic) {
    steps.push({
      type: "error",
      text: `Capability check failed: 402 amount ${accept.maxAmountRequired} does not match locked price ${expectedPrice} USDC (${expectedAtomic} atomic)`,
    });
    return { steps };
  }

  steps.push({
    type: "info",
    text: "Capability checks passed: payTo + amount match locked quote",
  });

  if (!config.buyerPrivateKey) {
    emit({
      status: 402,
      method: "POST",
      path: `${base}/buy`,
      store: slug,
      orderId,
      rail: "x402",
      message: "402 unpaid: BUYER_PRIVATE_KEY missing, cannot sign on Base Sepolia",
    });
    steps.push({
      type: "error",
      text: `402 is the challenge. Add BUYER_PRIVATE_KEY + funded ${config.tokenSymbol} on Base Sepolia, then Buy again.`,
    });
    return { steps, receipt: challenge as BuyerReceipt };
  }

  const account = privateKeyToAccount(config.buyerPrivateKey);
  const wallet = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(config.rpcUrl),
  }).extend(publicActions);

  steps.push({
    type: "chain",
    text: `Signing ${config.tokenSymbol} transfer ${accept.maxAmountRequired} → ${accept.payTo} on Base Sepolia`,
  });
  let txHash: `0x${string}`;
  try {
    txHash = await wallet.writeContract({
      address: config.tokenAddress,
      abi: erc20,
      functionName: "transfer",
      args: [accept.payTo, BigInt(accept.maxAmountRequired)],
      gas: 150_000n,
    });
    await wallet.waitForTransactionReceipt({ hash: txHash });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "transfer failed";
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
  const snowtrace = explorerTx(txHash);
  steps.push({ type: "chain", text: `Settled ${txHash}` });
  steps.push({ type: "success", text: snowtrace });

  const signature = Buffer.from(JSON.stringify({ txHash })).toString("base64");
  const second = await fetch(`${base}/buy`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "PAYMENT-SIGNATURE": signature,
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
      receipt: { txHash, explorerUrl: snowtrace, status: "verify-failed" },
    };
  }
  if (!receipt.explorerUrl && txHash) {
    receipt.explorerUrl = snowtrace;
    receipt.txHash = txHash;
  }
  steps.push({
    type: second.ok ? "success" : "error",
    text: `HTTP ${second.status} ${second.ok ? "receipt unlocked" : JSON.stringify(receipt)}`,
  });
  if (second.ok && receipt.explorerUrl) {
    steps.push({ type: "success", text: receipt.explorerUrl });
  }
  return { steps, receipt };
}
