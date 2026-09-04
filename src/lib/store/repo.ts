import { ensureUniqueSkuIds } from "@/lib/inventory/parse";
import { memoryRepo } from "@/lib/store/memory";
import type { StoreRecord } from "@/lib/store/types";
import type { StoreRepo } from "@/lib/store/types-repo";

function useDynamo() {
  return Boolean(process.env.AISLE_TABLE?.trim());
}

/** Dynamo rejects NaN; catch bad SKUs before marshalling. */
function assertStoreFinite(store: StoreRecord): StoreRecord {
  for (const sku of store.skus) {
    if (!Number.isFinite(sku.quantity) || sku.quantity <= 0) {
      throw new Error(
        `Invalid quantity for “${sku.title}” (got ${String(sku.quantity)}). Check CSV columns title,description,quantity,price — quote descriptions that contain commas.`,
      );
    }
    const priceNum = Number(sku.price);
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      throw new Error(
        `Invalid price for “${sku.title}” (got ${String(sku.price)}).`,
      );
    }
  }
  return store;
}

function normalizeStore(store: StoreRecord): StoreRecord {
  return ensureUniqueSkuIds(assertStoreFinite(store));
}

let dynamo: StoreRepo | null = null;

async function backend(): Promise<StoreRepo> {
  if (!useDynamo()) return memoryRepo;
  if (!dynamo) {
    const mod = await import("@/lib/store/dynamo");
    dynamo = mod.dynamoRepo;
  }
  return dynamo;
}

/** Async store. Memory locally; DynamoDB when AISLE_TABLE is set (Lambda / AWS). */
export const repo: StoreRepo = {
  listStores: async () => {
    const stores = await (await backend()).listStores();
    return stores.map((store) => ensureUniqueSkuIds(store));
  },
  getStore: async (slug) => {
    const store = await (await backend()).getStore(slug);
    return store ? ensureUniqueSkuIds(store) : null;
  },
  putStore: async (store) =>
    (await backend()).putStore(normalizeStore(store)),
  listOrders: async (slug) => (await backend()).listOrders(slug),
  getOrder: async (id) => (await backend()).getOrder(id),
  putOrder: async (order) => (await backend()).putOrder(order),
  getMandate: async (id) => (await backend()).getMandate(id),
  putMandate: async (m) => (await backend()).putMandate(m),
  burnMandate: async (id) => (await backend()).burnMandate(id),
  listReviews: async (slug) => (await backend()).listReviews(slug),
  getReview: async (id) => (await backend()).getReview(id),
  getReviewByOrderId: async (orderId) =>
    (await backend()).getReviewByOrderId(orderId),
  putReview: async (review) => (await backend()).putReview(review),
};
