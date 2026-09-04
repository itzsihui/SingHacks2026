import { isValidClassicAddress, Wallet } from "xrpl";
import { sign as signHex, verify as verifyHex } from "ripple-keypairs";
import { config } from "@/lib/config";

/** Classic XRPL address (r…). */
export type ClassicAddress = string;
/** @deprecated Alias — same as ClassicAddress after XRPL migration. */
export type HexAddress = ClassicAddress;

export type MerchantAuthProof = {
  address: ClassicAddress;
  publicKey: string;
  message: string;
  signature: string;
  network: string;
  authenticatedAt: string;
};

export function shortAddress(address: string, chars = 4) {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, chars + 1)}…${address.slice(-chars)}`;
}

export function parseMerchantAddress(
  value: string | null | undefined,
): ClassicAddress | null {
  const raw = value?.trim();
  if (!raw || !isValidClassicAddress(raw)) return null;
  return raw;
}

function buildAuthMessage(address: ClassicAddress): string {
  const issuedAt = new Date().toISOString();
  return [
    "Borneo — merchant wallet authentication",
    "",
    "Sign this message to prove you control the payout address for XRPL x402.",
    "This does not move funds or submit a ledger transaction.",
    "",
    `Address: ${address}`,
    `Network: ${config.network} (XRPL Testnet)`,
    `Issued at: ${issuedAt}`,
  ].join("\n");
}

function messageToHex(message: string): string {
  return Buffer.from(message, "utf8").toString("hex").toUpperCase();
}

/**
 * Prove control of an XRPL classic address by signing with the family seed.
 * Seed stays in the browser; only address + signature are sent to the server.
 */
export function authenticateWithXrplSeed(seed: string): MerchantAuthProof {
  const trimmed = seed.trim().replace(/^["']|["']$/g, "");
  if (!trimmed) {
    throw new Error("Paste your XRPL family seed / secret to bind the wallet.");
  }
  let wallet: Wallet;
  try {
    wallet = Wallet.fromSeed(trimmed);
  } catch {
    throw new Error("Invalid XRPL seed. Use a testnet family seed (s…).");
  }
  const address = wallet.classicAddress;
  const message = buildAuthMessage(address);
  const signature = signHex(messageToHex(message), wallet.privateKey);
  return {
    address,
    publicKey: wallet.publicKey,
    message,
    signature,
    network: config.network,
    authenticatedAt: new Date().toISOString(),
  };
}

/** Generate a fresh testnet wallet (show seed once to the merchant). */
export function generateMerchantWallet(): {
  seed: string;
  address: ClassicAddress;
} {
  const wallet = Wallet.generate();
  return { seed: wallet.seed!, address: wallet.classicAddress };
}

/** Server-side: verify XRPL seed ownership proof before accepting payTo. */
export async function verifyMerchantAuth(
  proof: MerchantAuthProof | null | undefined,
): Promise<ClassicAddress | null> {
  if (!proof?.address || !proof.message || !proof.signature || !proof.publicKey) {
    return null;
  }
  const address = parseMerchantAddress(proof.address);
  if (!address) return null;
  if (!proof.message.includes(address)) return null;
  const issued = proof.message.match(/Issued at:\s*(\S+)/)?.[1];
  if (issued) {
    const t = Date.parse(issued);
    if (!Number.isFinite(t) || Date.now() - t > 24 * 60 * 60 * 1000) {
      return null;
    }
  }
  try {
    const ok = verifyHex(
      messageToHex(proof.message),
      proof.signature,
      proof.publicKey,
    );
    return ok ? address : null;
  } catch {
    return null;
  }
}

/** @deprecated Use authenticateWithXrplSeed */
export const authenticateWithMetaMask = async (): Promise<MerchantAuthProof> => {
  throw new Error(
    "MetaMask is no longer used. Bind an XRPL classic address with your testnet seed.",
  );
};

export function hasMetaMask(): boolean {
  return false;
}

export async function getMetaMaskAccounts(): Promise<ClassicAddress[]> {
  return [];
}

export function onMetaMaskAccountsChanged(
  _handler: (accounts: ClassicAddress[]) => void,
): () => void {
  return () => undefined;
}
