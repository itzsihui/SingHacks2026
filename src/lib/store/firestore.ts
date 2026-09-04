import { sampleMarketStores } from "@/lib/market/sample-stores";
import {
  getCatalogStore,
  listCatalogStores,
  putCatalogStore,
} from "@/lib/store/firestore-catalog";
import { getServerFirestore } from "@/lib/firebase/server";
import type { StoreRepo } from "@/lib/store/types-repo";
import type { StoreRecord } from "@/lib/store/types";

/**
 * Durable catalog on Firestore `stores/{slug}`; orders/mandates/reviews stay
 * on the in-memory fallback (same process). Sample demo shops remain visible
 * unless a published store reuses their slug.
 */
export function createFirestoreStoreRepo(fallback: StoreRepo): StoreRepo {
  async function mergeStoreMaps(
    cloud: StoreRecord[],
    local: StoreRecord[],
  ): Promise<StoreRecord[]> {
    const bySlug = new Map<string, StoreRecord>();
    for (const store of sampleMarketStores()) {
      bySlug.set(store.slug, { ...store, listOnMarket: true });
    }
    for (const store of local) {
      // Prefer merchant-owned / non-sample over seed when present in memory
      const prev = bySlug.get(store.slug);
      if (!prev || store.ownerUid || prev.ownerUid) {
        bySlug.set(store.slug, store);
      }
    }
    for (const store of cloud) {
      bySlug.set(store.slug, store);
    }
    return [...bySlug.values()];
  }

  return {
    async listStores() {
      const local = await fallback.listStores();
      const db = getServerFirestore();
      if (!db) return local;
      try {
        const cloud = await listCatalogStores(db);
        return mergeStoreMaps(cloud, local);
      } catch (err) {
        console.warn(
          "[firestore-catalog] listStores failed; using memory/samples",
          err,
        );
        return local;
      }
    },

    async getStore(slug) {
      const db = getServerFirestore();
      if (db) {
        try {
          const cloud = await getCatalogStore(db, slug);
          if (cloud) return cloud;
        } catch (err) {
          console.warn(
            `[firestore-catalog] getStore(${slug}) failed`,
            err,
          );
        }
      }
      return fallback.getStore(slug);
    },

    async putStore(store) {
      const saved = await fallback.putStore(store);
      const db = getServerFirestore();
      if (db) {
        try {
          await putCatalogStore(db, saved);
        } catch (err) {
          console.warn(
            `[firestore-catalog] putStore(${saved.slug}) failed — client publish will retry`,
            err,
          );
        }
      }
      return saved;
    },

    listOrders: (slug) => fallback.listOrders(slug),
    getOrder: (id) => fallback.getOrder(id),
    putOrder: (order) => fallback.putOrder(order),
    getMandate: (id) => fallback.getMandate(id),
    putMandate: (m) => fallback.putMandate(m),
    burnMandate: (id) => fallback.burnMandate(id),
    listReviews: (slug) => fallback.listReviews(slug),
    getReview: (id) => fallback.getReview(id),
    getReviewByOrderId: (orderId) => fallback.getReviewByOrderId(orderId),
    putReview: (review) => fallback.putReview(review),
  };
}
