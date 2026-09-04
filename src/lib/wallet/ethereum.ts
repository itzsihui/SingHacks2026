import {
  getAddress,
  isAddress,
  verifyMessage,
  type Hex,
} from "viem";

export type HexAddress = `0x${string}`;

export type MerchantAuthProof = {
  address: HexAddress;
  message: string;
  signature: Hex;
  chainId: number;
  authenticatedAt: string;
};

type EthereumProvider = {
  isMetaMask?: boolean;
  request: (args: {
    method: string;
    params?: unknown[];
  }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (
    event: string,
    handler: (...args: unknown[]) => void,
  ) => void;
  providers?: EthereumProvider[];
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

/** Base Sepolia — hackathon settlement chain (USDC). */
export const BASE_SEPOLIA = {
  chainId: 84532,
  chainIdHex: "0x14a34",
  chainName: "Base Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://sepolia.base.org"],
  blockExplorerUrls: ["https://sepolia.basescan.org"],
} as const;

/** @deprecated Use BASE_SEPOLIA — kept for any leftover Fuji imports. */
export const FUJI = BASE_SEPOLIA;

export function shortAddress(address: string, chars = 4) {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 2 + chars)}…${address.slice(-chars)}`;
}

export function parseMerchantAddress(
  value: string | null | undefined,
): HexAddress | null {
  const raw = value?.trim();
  if (!raw || !isAddress(raw)) return null;
  return getAddress(raw) as HexAddress;
}

/** Prefer the MetaMask provider when multiple wallets are injected. */
export function getMetaMaskProvider(): EthereumProvider | null {
  if (typeof window === "undefined") return null;
  const eth = window.ethereum;
  if (!eth) return null;
  if (Array.isArray(eth.providers) && eth.providers.length > 0) {
    return (
      eth.providers.find((p) => p.isMetaMask) ||
      eth.providers[0] ||
      null
    );
  }
  return eth;
}

export function hasMetaMask(): boolean {
  return Boolean(getMetaMaskProvider());
}

async function requestAccounts(provider: EthereumProvider): Promise<HexAddress> {
  const accounts = (await provider.request({
    method: "eth_requestAccounts",
  })) as string[];
  const parsed = parseMerchantAddress(accounts?.[0]);
  if (!parsed) {
    throw new Error("MetaMask returned no account. Unlock MetaMask and try again.");
  }
  return parsed;
}

async function ensureBaseSepolia(provider: EthereumProvider): Promise<number> {
  const current = (await provider.request({
    method: "eth_chainId",
  })) as string;
  const chainId = Number.parseInt(current, 16);
  if (chainId === BASE_SEPOLIA.chainId) return chainId;

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: BASE_SEPOLIA.chainIdHex }],
    });
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? Number((error as { code: number }).code)
        : 0;
    // 4902 = chain not added
    if (code === 4902 || code === -32603) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: BASE_SEPOLIA.chainIdHex,
            chainName: BASE_SEPOLIA.chainName,
            nativeCurrency: BASE_SEPOLIA.nativeCurrency,
            rpcUrls: [...BASE_SEPOLIA.rpcUrls],
            blockExplorerUrls: [...BASE_SEPOLIA.blockExplorerUrls],
          },
        ],
      });
    } else if (code === 4001) {
      throw new Error("Switch to Base Sepolia in MetaMask to continue.");
    } else {
      throw error instanceof Error
        ? error
        : new Error("Could not switch MetaMask to Base Sepolia.");
    }
  }

  const after = (await provider.request({
    method: "eth_chainId",
  })) as string;
  return Number.parseInt(after, 16);
}

function buildAuthMessage(address: HexAddress): string {
  const issuedAt = new Date().toISOString();
  return [
    "Borneo — merchant wallet authentication",
    "",
    "Sign this message to prove you control the payout address for x402.",
    "This does not move funds or approve spending.",
    "",
    `Address: ${address}`,
    `Chain ID: ${BASE_SEPOLIA.chainId} (Base Sepolia)`,
    `Issued at: ${issuedAt}`,
  ].join("\n");
}

/**
 * Full MetaMask auth: connect popup → Base Sepolia → personal_sign ownership proof.
 */
export async function authenticateWithMetaMask(): Promise<MerchantAuthProof> {
  const provider = getMetaMaskProvider();
  if (!provider) {
    throw new Error(
      "MetaMask not found. Install the MetaMask extension, then click Connect again.",
    );
  }

  const address = await requestAccounts(provider);
  const chainId = await ensureBaseSepolia(provider);
  if (chainId !== BASE_SEPOLIA.chainId) {
    throw new Error("Please approve switching MetaMask to Base Sepolia.");
  }

  const message = buildAuthMessage(address);
  const signature = (await provider.request({
    method: "personal_sign",
    params: [message, address],
  })) as string;

  if (!signature?.startsWith("0x")) {
    throw new Error("MetaMask did not return a signature.");
  }

  return {
    address,
    message,
    signature: signature as Hex,
    chainId,
    authenticatedAt: new Date().toISOString(),
  };
}

/** Server-side: verify MetaMask personal_sign before accepting payTo. */
export async function verifyMerchantAuth(
  proof: MerchantAuthProof | null | undefined,
): Promise<HexAddress | null> {
  if (!proof?.address || !proof.message || !proof.signature) return null;
  const address = parseMerchantAddress(proof.address);
  if (!address) return null;
  if (!proof.message.includes(address)) return null;
  // Reject stale proofs (>24h)
  const issued = proof.message.match(/Issued at:\s*(\S+)/)?.[1];
  if (issued) {
    const t = Date.parse(issued);
    if (!Number.isFinite(t) || Date.now() - t > 24 * 60 * 60 * 1000) {
      return null;
    }
  }
  try {
    const ok = await verifyMessage({
      address,
      message: proof.message,
      signature: proof.signature,
    });
    return ok ? address : null;
  } catch {
    return null;
  }
}

export async function getMetaMaskAccounts(): Promise<HexAddress[]> {
  const provider = getMetaMaskProvider();
  if (!provider) return [];
  try {
    const accounts = (await provider.request({
      method: "eth_accounts",
    })) as string[];
    return accounts
      .map((a) => parseMerchantAddress(a))
      .filter((a): a is HexAddress => Boolean(a));
  } catch {
    return [];
  }
}

export function onMetaMaskAccountsChanged(
  handler: (accounts: HexAddress[]) => void,
): () => void {
  const provider = getMetaMaskProvider();
  if (!provider?.on) return () => undefined;
  const listener = (accounts: unknown) => {
    const list = Array.isArray(accounts)
      ? accounts
          .map((a) => parseMerchantAddress(String(a)))
          .filter((a): a is HexAddress => Boolean(a))
      : [];
    handler(list);
  };
  provider.on("accountsChanged", listener);
  return () => provider.removeListener?.("accountsChanged", listener);
}
