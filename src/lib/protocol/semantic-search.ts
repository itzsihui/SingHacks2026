import {
  filterMarketProducts,
  type MarketProduct,
} from "@/lib/protocol/registry";

const EMBED_MODEL = "text-embedding-3-small";
const DEFAULT_LIMIT = 8;
const MIN_SCORE = 0.28;

export type SearchHit = MarketProduct & {
  score: number;
  buyX402: string;
  catalog: string;
};

export type SemanticSearchResult = {
  query: string;
  mode: "semantic" | "keyword";
  model: string | null;
  productCount: number;
  products: SearchHit[];
};

type CacheEntry = {
  fingerprint: string;
  vectors: Float32Array[];
  texts: string[];
};

let catalogCache: CacheEntry | null = null;

function openaiKey() {
  return process.env.OPENAI_API_KEY?.trim() || "";
}

function productText(p: MarketProduct) {
  return [p.title, p.description, p.storeName, p.id]
    .filter(Boolean)
    .join(" · ");
}

function catalogFingerprint(products: MarketProduct[]) {
  return products.map((p) => `${p.storeSlug}:${p.id}:${p.title}`).join("|");
}

function cosine(a: Float32Array, b: Float32Array) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function embedBatch(texts: string[]): Promise<Float32Array[] | null> {
  const key = openaiKey();
  if (!key || texts.length === 0) return null;

  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: EMBED_MODEL,
        input: texts,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      data?: { embedding: number[]; index: number }[];
    };
    if (!data.data?.length) return null;
    const sorted = [...data.data].sort((a, b) => a.index - b.index);
    return sorted.map((row) => Float32Array.from(row.embedding));
  } catch {
    return null;
  }
}

async function ensureCatalogVectors(products: MarketProduct[]) {
  const fingerprint = catalogFingerprint(products);
  if (catalogCache?.fingerprint === fingerprint) return catalogCache;

  const texts = products.map(productText);
  const vectors = await embedBatch(texts);
  if (!vectors || vectors.length !== products.length) return null;

  catalogCache = { fingerprint, vectors, texts };
  return catalogCache;
}

function withAgentUrls(
  products: MarketProduct[],
  origin: string,
  scores: number[],
): SearchHit[] {
  return products.map((p, i) => ({
    ...p,
    score: Math.round((scores[i] ?? 0) * 1000) / 1000,
    buyX402: `${origin}/s/${p.storeSlug}/buy`,
    catalog: `${origin}/s/${p.storeSlug}/catalog.json`,
  }));
}

function keywordHits(
  products: MarketProduct[],
  query: string,
  origin: string,
  limit: number,
): SemanticSearchResult {
  const filtered = filterMarketProducts(products, query).slice(0, limit);
  return {
    query,
    mode: "keyword",
    model: null,
    productCount: filtered.length,
    products: withAgentUrls(
      filtered,
      origin,
      filtered.map((_, i) => 1 - i * 0.05),
    ),
  };
}

/**
 * Intent search over the live market catalog.
 * Uses OpenAI embeddings when available; otherwise keyword overlap.
 */
export async function semanticSearchMarket(args: {
  products: MarketProduct[];
  query: string;
  origin: string;
  limit?: number;
}): Promise<SemanticSearchResult> {
  const query = args.query.trim();
  const limit = Math.min(Math.max(args.limit ?? DEFAULT_LIMIT, 1), 24);
  if (!query) {
    return {
      query: "",
      mode: "keyword",
      model: null,
      productCount: 0,
      products: [],
    };
  }
  if (args.products.length === 0) {
    return {
      query,
      mode: "keyword",
      model: null,
      productCount: 0,
      products: [],
    };
  }

  const cache = await ensureCatalogVectors(args.products);
  const [queryVec] = (await embedBatch([query])) ?? [];

  if (!cache || !queryVec) {
    return keywordHits(args.products, query, args.origin, limit);
  }

  const scored = args.products
    .map((product, i) => ({
      product,
      score: cosine(queryVec, cache.vectors[i]!),
    }))
    .filter((row) => row.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  if (scored.length === 0) {
    return keywordHits(args.products, query, args.origin, limit);
  }

  return {
    query,
    mode: "semantic",
    model: EMBED_MODEL,
    productCount: scored.length,
    products: withAgentUrls(
      scored.map((s) => s.product),
      args.origin,
      scored.map((s) => s.score),
    ),
  };
}
