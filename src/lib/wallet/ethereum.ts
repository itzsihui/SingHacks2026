/**
 * Compatibility shim — wallet auth moved to XRPL classic addresses.
 * Prefer importing from `@/lib/wallet/xrpl`.
 */
export {
  type ClassicAddress,
  type HexAddress,
  type MerchantAuthProof,
  shortAddress,
  parseMerchantAddress,
  authenticateWithXrplSeed,
  authenticateWithMetaMask,
  generateMerchantWallet,
  verifyMerchantAuth,
  hasMetaMask,
  getMetaMaskAccounts,
  onMetaMaskAccountsChanged,
} from "@/lib/wallet/xrpl";

/** @deprecated XRPL has no EVM chain id; kept for leftover imports. */
export const BASE_SEPOLIA = {
  chainId: 1,
  chainIdHex: "0x1",
  chainName: "XRPL Testnet",
  nativeCurrency: { name: "XRP", symbol: "XRP", decimals: 6 },
  rpcUrls: ["https://s.altnet.rippletest.net:51234/"],
  blockExplorerUrls: ["https://testnet.xrpl.org"],
} as const;

export const FUJI = BASE_SEPOLIA;
