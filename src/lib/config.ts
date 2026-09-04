export type ChainNetwork = "base-sepolia";

function env(name: string, fallback: string) {
  return process.env[name] || fallback;
}

export const config = {
  rpcUrl: env(
    "BASE_RPC_URL",
    env("AVALANCHE_RPC_URL", "https://sepolia.base.org"),
  ),
  network: env(
    "BASE_NETWORK",
    env("AVALANCHE_NETWORK", "base-sepolia"),
  ) as ChainNetwork,
  chainId: Number(env("CHAIN_ID", "84532")),
  tokenAddress: env(
    "TOKEN_ADDRESS",
    "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  ) as `0x${string}`,
  tokenSymbol: env("TOKEN_SYMBOL", "USDC"),
  tokenDecimals: Number(env("TOKEN_DECIMALS", "6")),
  /** Demo unit price in USDC on Base Sepolia. */
  demoUnitPriceXsgd: "0.01",
  merchantAddress: env(
    "MERCHANT_ADDRESS",
    "0x0000000000000000000000000000000000000000",
  ) as `0x${string}`,
  get buyerPrivateKey() {
    const raw = process.env.BUYER_PRIVATE_KEY?.trim().replace(/^["']|["']$/g, "");
    if (!raw) return undefined;
    const key = raw.startsWith("0x") ? raw : `0x${raw}`;
    // Private keys are 32 bytes = 66 hex chars with 0x. Addresses are 42 — reject those.
    return key.length === 66 && /^0x[0-9a-fA-F]{64}$/.test(key)
      ? (key as `0x${string}`)
      : undefined;
  },
  explorerBase: env("EXPLORER_BASE", "https://sepolia.basescan.org"),
  /** Optional legacy Card MCP URL — unused when empty; Visa rail uses local mandate. */
  straitsxMcpUrl: env("STRAITSX_MCP_URL", ""),
  get straitsxMcpToken() {
    return (
      process.env.STRAITSX_MCP_TOKEN?.trim() ||
      process.env.STRAITSX_API_KEY?.trim() ||
      undefined
    );
  },
  bedrockRegion: env("AWS_REGION", "ap-southeast-1"),
  bedrockModel: env(
    "BEDROCK_MODEL_ID",
    "anthropic.claude-3-haiku-20240307-v1:0",
  ),
  /** When set, buyer/card agents hit API Gateway instead of the Next origin. */
  get protocolBaseUrl() {
    return (
      process.env.PROTOCOL_BASE_URL?.trim() ||
      process.env.NEXT_PUBLIC_PROTOCOL_BASE_URL?.trim() ||
      undefined
    );
  },
};

export function explorerTx(hash: string) {
  return `${config.explorerBase}/tx/${hash}`;
}

export function toAtomic(price: string) {
  const n = Number(price);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid price: ${price}`);
  }
  return BigInt(Math.round(n * 10 ** config.tokenDecimals)).toString();
}

export function fromAtomic(atomic: string) {
  const v = Number(atomic) / 10 ** config.tokenDecimals;
  return v.toFixed(2);
}
