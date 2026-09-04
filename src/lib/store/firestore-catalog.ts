import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  type Firestore,
} from "firebase/firestore";
import type { StoreRecord, StoreVisaReceive } from "@/lib/store/types";

export const STORES_COLLECTION = "stores";

function stripUndefined<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function asClassicAddress(value: unknown): string | null {
  const s = String(value || "").trim();
  if (!/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(s)) return null;
  return s;
}

function normalizeVisa(raw: unknown): StoreVisaReceive | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const v = raw as Record<string, unknown>;
  const accountLabel = String(v.accountLabel || "").trim();
  if (!accountLabel) return undefined;
  return {
    accountLabel,
    receiveId: v.receiveId ? String(v.receiveId) : undefined,
    settlementNote: v.settlementNote ? String(v.settlementNote) : undefined,
  };
}

/** Normalize a Firestore / JSON blob into a StoreRecord. */
export function normalizeStoreRecord(raw: unknown): StoreRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  const slug = String(data.slug || "").trim();
  const name = String(data.name || "").trim();
  const merchantAddress = asClassicAddress(data.merchantAddress);
  if (!slug || !name || !merchantAddress) return null;
  if (!Array.isArray(data.skus) || data.skus.length === 0) return null;

  const skus = data.skus
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const sku = item as Record<string, unknown>;
      const title = String(sku.title || "").trim();
      const quantity = Number(sku.quantity);
      const priceNum = Number(sku.price);
      if (!title || !Number.isFinite(quantity) || quantity <= 0) return null;
      if (!Number.isFinite(priceNum) || priceNum <= 0) return null;
      return {
        id: String(sku.id || `sku-${index + 1}`),
        title,
        description: String(sku.description || title),
        quantity,
        price: priceNum.toFixed(2),
      };
    })
    .filter((s): s is NonNullable<typeof s> => Boolean(s));

  if (skus.length === 0) return null;

  return {
    slug,
    name,
    ownerUid: data.ownerUid ? String(data.ownerUid) : undefined,
    merchantDisplayName: data.merchantDisplayName
      ? String(data.merchantDisplayName)
      : undefined,
    merchantAddress,
    visaReceive: normalizeVisa(data.visaReceive),
    listOnMarket: data.listOnMarket !== false,
    skus,
    createdAt: String(data.createdAt || new Date().toISOString()),
  };
}

export async function listCatalogStores(
  db: Firestore,
): Promise<StoreRecord[]> {
  const snap = await getDocs(collection(db, STORES_COLLECTION));
  const stores: StoreRecord[] = [];
  for (const docSnap of snap.docs) {
    const store = normalizeStoreRecord({ slug: docSnap.id, ...docSnap.data() });
    if (store) stores.push(store);
  }
  return stores;
}

export async function getCatalogStore(
  db: Firestore,
  slug: string,
): Promise<StoreRecord | null> {
  const key = slug.trim();
  if (!key) return null;
  const snap = await getDoc(doc(db, STORES_COLLECTION, key));
  if (!snap.exists()) return null;
  return normalizeStoreRecord({ slug: key, ...snap.data() });
}

export async function putCatalogStore(
  db: Firestore,
  store: StoreRecord,
): Promise<StoreRecord> {
  const payload = stripUndefined({
    ...store,
    listOnMarket: store.listOnMarket !== false,
    updatedAt: new Date().toISOString(),
  });
  await setDoc(doc(db, STORES_COLLECTION, store.slug), payload, { merge: true });
  return store;
}
