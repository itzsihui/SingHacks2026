export type Sku = {
  id: string;
  title: string;
  description: string;
  quantity: number;
  price: string;
};

/** Merchant Visa/fiat receiving account stamped onto the store at publish. */
export type StoreVisaReceive = {
  accountLabel: string;
  receiveId?: string;
  settlementNote?: string;
};

export type StoreRecord = {
  slug: string;
  name: string;
  /** Firebase merchant uid that owns this store. */
  ownerUid?: string;
  merchantDisplayName?: string;
  /** Crypto receiving wallet (x402 payTo). */
  merchantAddress: `0x${string}`;
  /** Visa/fiat receiving account snapshot for card rail settlement display. */
  visaReceive?: StoreVisaReceive;
  skus: Sku[];
  createdAt: string;
};

export type CardMandate = {
  spendCap: string;
  merchant: string;
  expiresAt: string;
  cardOpaqueId?: string;
  truncatedPan?: string;
  status?: "active" | "burned";
  source?: "straitsx-mcp" | "local-mandate";
  burnedAt?: string;
};

export type Order = {
  id: string;
  slug: string;
  skuId: string;
  quantity: number;
  amountAtomic: string;
  status: "pending" | "paid" | "failed";
  rail: "x402" | "straitsx-card";
  txHash?: string;
  explorerUrl?: string;
  mandate?: CardMandate;
  /** Firebase buyer uid when known at settle. */
  buyerUid?: string;
  createdAt: string;
  paidAt?: string;
};

export type ReviewRating = 1 | 2 | 3 | 4 | 5;

/** Verified-purchase product review (one per paid order). */
export type Review = {
  id: string;
  orderId: string;
  slug: string;
  skuId: string;
  rating: ReviewRating;
  tags?: string[];
  /** Untrusted prose — agents should prefer rating + tags. */
  comment?: string;
  buyerUid: string;
  createdAt: string;
};

export type ProtocolEvent = {
  ts: number;
  status: number;
  method: string;
  path: string;
  store?: string;
  orderId?: string;
  message: string;
  rail?: Order["rail"];
};
