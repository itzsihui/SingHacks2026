import { createPublicClient, decodeEventLog, http, parseAbiItem } from "viem";
import { baseSepolia } from "viem/chains";
import { config, explorerTx, toAtomic } from "@/lib/config";
import type { Sku, StoreRecord } from "@/lib/store/types";

const transferEvent = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

export type PaymentRequired = {
  x402Version: 1;
  accepts: Array<{
    scheme: "exact";
    network: string;
    maxAmountRequired: string;
    resource: string;
    description: string;
    mimeType: string;
    payTo: `0x${string}`;
    maxTimeoutSeconds: number;
    asset: `0x${string}`;
    extra: { name: string; decimals: number; orderId: string };
  }>;
  error?: string;
};

export function buildPaymentRequired(
  store: StoreRecord,
  sku: Sku,
  origin: string,
  orderId: string,
  quantity: number,
): PaymentRequired {
  const amount = (
    BigInt(toAtomic(sku.price)) * BigInt(quantity)
  ).toString();
  return {
    x402Version: 1,
    accepts: [
      {
        scheme: "exact",
        network: config.network,
        maxAmountRequired: amount,
        resource: `${origin}/s/${store.slug}/buy`,
        description: `${sku.title} x${quantity}`,
        mimeType: "application/json",
        payTo: store.merchantAddress,
        maxTimeoutSeconds: 60,
        asset: config.tokenAddress,
        extra: {
          name: config.tokenSymbol,
          decimals: config.tokenDecimals,
          orderId,
        },
      },
    ],
  };
}

export function parsePaymentSignature(header: string): `0x${string}` | null {
  const raw = header.trim();
  if (raw.startsWith("0x") && raw.length === 66) return raw as `0x${string}`;
  try {
    const decoded = JSON.parse(
      Buffer.from(raw, "base64").toString("utf8"),
    ) as { txHash?: string };
    if (decoded.txHash?.startsWith("0x")) {
      return decoded.txHash as `0x${string}`;
    }
  } catch {
    try {
      const decoded = JSON.parse(raw) as { txHash?: string };
      if (decoded.txHash?.startsWith("0x")) {
        return decoded.txHash as `0x${string}`;
      }
    } catch {
      return null;
    }
  }
  return null;
}

export async function verifyTransfer(args: {
  txHash: `0x${string}`;
  payTo: `0x${string}`;
  amountAtomic: string;
}) {
  try {
    const client = createPublicClient({
      chain: baseSepolia,
      transport: http(config.rpcUrl),
    });
    const receipt = await client.getTransactionReceipt({ hash: args.txHash });
    if (receipt.status !== "success") {
      return { ok: false as const, reason: "Transaction reverted" };
    }

    const expected = BigInt(args.amountAtomic);
    const payTo = args.payTo.toLowerCase();
    const token = config.tokenAddress.toLowerCase();

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== token) continue;
      try {
        const decoded = decodeEventLog({
          abi: [transferEvent],
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName !== "Transfer") continue;
        const to = String(decoded.args.to).toLowerCase();
        const value = decoded.args.value as bigint;
        if (to === payTo && value === expected) {
          return {
            ok: true as const,
            explorerUrl: explorerTx(args.txHash),
          };
        }
      } catch {
        continue;
      }
    }

    return {
      ok: false as const,
      reason: `No ${config.tokenSymbol} Transfer of ${args.amountAtomic} to ${args.payTo}`,
    };
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "verifyTransfer failed";
    return { ok: false as const, reason };
  }
}

export function paymentRequiredHeaders(body: PaymentRequired) {
  return {
    "content-type": "application/json",
    "PAYMENT-REQUIRED": Buffer.from(JSON.stringify(body)).toString("base64"),
    "cache-control": "no-store",
  };
}
