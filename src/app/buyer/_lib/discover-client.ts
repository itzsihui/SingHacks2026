import { imageForProduct } from "@/lib/market/product-images";
import type { BuyerSizingPrefs } from "@/lib/buyer-account";
import type { FashionProfile, MarketProductPick } from "./buyer-flow";
import {
  formatFlagSummary,
  quarantineCatalog,
  wantsInjectionDemo,
  type QuarantinedSku,
} from "./catalog-quarantine";
import { decomposeIntent, extractItemHints } from "./intent-decompose";

type MarketApiProduct = {
  id: string;
  title: string;
  description?: string;
  price: string;
  quantity: number;
  storeSlug: string;
  storeName: string;
  merchantDisplayName?: string;
  merchantAddress?: `0x${string}`;
  visaReceiveLabel?: string;
  visaReceiveId?: string;
  imageUrl?: string;
};

type MarketPayload = {
  products: MarketApiProduct[];
};

const STOP = new Set([
  "a",
  "an",
  "the",
  "i",
  "im",
  "i'm",
  "want",
  "wanna",
  "need",
  "get",
  "buy",
  "looking",
  "for",
  "with",
  "my",
  "me",
  "to",
  "and",
  "or",
  "of",
  "in",
  "on",
  "at",
  "it",
  "its",
  "is",
  "are",
  "be",
  "as",
  "long",
  "really",
  "just",
  "something",
  "anything",
  "please",
  "under",
  "below",
  "about",
  "going",
  "hang",
  "out",
  "friends",
  "comfortable",
  "comfort",
  "key",
  "preferred",
  "preference",
  "color",
  "colour",
  "budget",
  "usdc",
  "xsgd",
  "usd",
  "sgd",
  "soon",
  "have",
  "has",
  "had",
  "full",
  "nice",
  "good",
  "best",
  "today",
  "tomorrow",
  "gonna",
  "gotta",
  "casual",
  "style",
  "date",
  "night",
  "dinner",
]);

/** Product-noun synonyms only — never occasion/style words (those diluted ranking). */
const PRODUCT_SYNONYMS: Record<string, string[]> = {
  tee: ["tee", "tshirt", "shirt"],
  tshirt: ["tee", "tshirt", "shirt"],
  shirt: ["shirt", "tee", "tshirt", "blouse", "top"],
  blouse: ["blouse", "shirt", "top"],
  top: ["top", "shirt", "tee", "blouse"],
  cap: ["cap", "hat", "beanie"],
  hat: ["hat", "cap", "beanie"],
  jeans: ["jeans", "denim", "pants", "trousers"],
  jean: ["jeans", "denim", "pants", "trousers"],
  pants: ["pants", "jeans", "denim", "trousers"],
  pant: ["pants", "jeans", "denim", "trousers"],
  trousers: ["trousers", "pants", "jeans"],
  trouser: ["trousers", "pants", "jeans"],
  shorts: ["shorts", "pants"],
  short: ["shorts", "pants"],
  sneakers: ["sneakers", "shoes", "trainers"],
  sneaker: ["sneakers", "shoes", "trainers"],
  shoes: ["shoes", "sneakers", "trainers"],
  shoe: ["shoes", "sneakers", "trainers"],
};

/** Occasion → garment hunt when the shopper didn't name pieces. */
const OCCASION_GARMENTS: Record<string, string[]> = {
  formal: ["shirt", "pants", "blouse"],
  professional: ["shirt", "pants", "blouse"],
  dressy: ["shirt", "pants", "blouse"],
  presentation: ["shirt", "pants", "blouse"],
  interview: ["shirt", "pants", "blouse"],
  office: ["shirt", "pants", "trousers"],
  meeting: ["shirt", "pants"],
  outfit: ["shirt", "pants", "jeans"],
  set: ["shirt", "pants", "jeans"],
};

/** Plurals that must not lose their last "s" (stem("jeans") → "jean" broke synonyms). */
const KEEP_PLURAL = new Set([
  "jeans",
  "pants",
  "trousers",
  "shorts",
  "shoes",
  "sneakers",
  "glasses",
  "clothes",
]);

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/t-shirt/g, "tshirt")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stem(s: string) {
  if (KEEP_PLURAL.has(s)) return s;
  if (s.endsWith("ies") && s.length > 4) return `${s.slice(0, -3)}y`;
  if (s.endsWith("sses")) return s.slice(0, -2);
  if (s.endsWith("s") && !s.endsWith("ss") && s.length > 3) return s.slice(0, -1);
  return s;
}

function tokensFrom(text: string): string[] {
  return normalize(text)
    .split(/\s+/)
    .map(stem)
    .filter((t) => t.length > 1 && !STOP.has(t) && !/^\d+(\.\d+)?$/.test(t));
}

function expandProductToken(token: string): string[] {
  const syn = PRODUCT_SYNONYMS[token] || PRODUCT_SYNONYMS[stem(token)];
  if (!syn) return [token];
  return [...new Set(syn.map((s) => (KEEP_PLURAL.has(s) ? s : stem(s))))];
}

function expandOccasionTokens(tokens: string[]): string[] {
  const out: string[] = [];
  for (const t of tokens) {
    const garments = OCCASION_GARMENTS[t];
    if (garments) out.push(...garments);
  }
  return out;
}

/**
 * Build ranking terms from catalog nouns only.
 * Occasion words expand to garments when no product noun is present yet.
 */
function queryTerms(
  intent: string,
  profile?: FashionProfile | null,
  hints?: string[],
): string[] {
  const parts = [intent, profile?.item, profile?.color, ...(hints || [])]
    .filter(Boolean)
    .join(" ");
  const raw = tokensFrom(parts);
  const productHits = raw.filter((t) => PRODUCT_SYNONYMS[t] || PRODUCT_SYNONYMS[stem(t)]);
  const occasionHits = expandOccasionTokens(raw);

  const seed =
    productHits.length > 0
      ? raw.filter((t) => !OCCASION_GARMENTS[t])
      : [...raw.filter((t) => !OCCASION_GARMENTS[t]), ...occasionHits];

  // Multi-item profile: prefer those nouns over free-text noise
  if (profile?.items?.length) {
    seed.push(...profile.items.map((i) => normalize(i)));
  }

  const expanded = new Set<string>();
  for (const t of seed) {
    for (const e of expandProductToken(stem(t))) expanded.add(e);
  }

  // Style is cosmetic preference — only keep if it is a color-like leftover, never occasion expansion
  if (profile?.style) {
    const styleTok = tokensFrom(profile.style).filter(
      (t) => !OCCASION_GARMENTS[t] && t !== "casual" && t !== "professional",
    );
    for (const t of styleTok) {
      for (const e of expandProductToken(t)) expanded.add(e);
    }
  }

  return [...expanded];
}

function rankTitle(product: MarketApiProduct, q: QuarantinedSku): string {
  return q.safeForFashionRank
    ? product.title
    : `${product.id} ${q.displayTitle}`;
}

/** Score using quarantined display title — never raw hostile instructions. */
function scoreProduct(
  product: MarketApiProduct,
  q: QuarantinedSku,
  terms: string[],
): number {
  if (terms.length === 0) return 0;
  const titleSource = rankTitle(product, q);
  const titleTokens = new Set(tokensFrom(`${product.id} ${titleSource}`));
  const title = normalize(titleSource);
  const id = normalize(product.id);
  let score = 0;
  let hits = 0;

  for (const term of terms) {
    if (titleTokens.has(term) || id === term) {
      hits += 1;
      score += 50;
      continue;
    }
    if (title.includes(term) || id.includes(term)) {
      hits += 1;
      score += 42;
      continue;
    }
    // Tight partials only (avoid "top" ⊆ "stop"-style noise on short stems)
    if (term.length < 3) continue;
    for (const ht of titleTokens) {
      if (ht.length < 3) continue;
      if (ht.startsWith(term) || term.startsWith(ht)) {
        hits += 1;
        score += 22;
        break;
      }
    }
  }

  if (hits === 0) return 0;

  score += Math.round((hits / terms.length) * 20);

  if (!q.safeForFashionRank) {
    score = Math.max(1, Math.round(score * 0.05));
  }

  return score;
}

function parseBudgetMax(profile?: FashionProfile | null): number | null {
  if (!profile?.budget) return null;
  const m = profile.budget.match(/([\d.]+)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function toPick(
  product: MarketApiProduct,
  q: QuarantinedSku,
  score: number,
): MarketProductPick {
  return {
    id: `${product.storeSlug}:${product.id}`,
    title: product.title,
    description: product.description,
    price: product.price,
    quantity: product.quantity,
    storeSlug: product.storeSlug,
    storeName: product.storeName,
    merchantDisplayName: product.merchantDisplayName,
    merchantAddress: product.merchantAddress,
    visaReceiveLabel: product.visaReceiveLabel,
    visaReceiveId: product.visaReceiveId,
    imageUrl:
      product.imageUrl ||
      imageForProduct(product.title, product.description, product.id),
    score,
    injectionFlags: q.injectionFlags.length ? q.injectionFlags : undefined,
    quarantined: q.injectionFlags.length > 0,
  };
}

function considerPick(
  scored: Map<string, MarketProductPick>,
  flaggedSeen: Map<string, QuarantinedSku>,
  product: MarketApiProduct,
  q: QuarantinedSku,
  score: number,
  demoIntent: boolean,
) {
  if (score <= 0) return;
  const key = `${product.storeSlug}:${product.id}`;
  if (!q.safeForFashionRank) {
    flaggedSeen.set(key, q);
    if (!demoIntent) return;
  }
  const pick = toPick(product, q, score);
  const existing = scored.get(pick.id);
  if (!existing || pick.score > existing.score) scored.set(pick.id, pick);
}

export async function discoverFashionPicks(
  intent: string,
  profile?: FashionProfile | null,
  searchQueries?: string[],
  opts?: { excludeSkuIds?: string[]; sizing?: BuyerSizingPrefs | null },
): Promise<{
  picks: MarketProductPick[];
  flagged: QuarantinedSku[];
  decomposed: ReturnType<typeof decomposeIntent>;
  storeSlugs: string[];
}> {
  const queries = (
    searchQueries?.length
      ? searchQueries
      : profile?.items?.length
        ? profile.items
        : [intent]
  )
    .map((q) => q.trim())
    .filter(Boolean);

  const primaryIntent = queries.join(" ") || intent;
  const decomposed = decomposeIntent(primaryIntent);
  const hints = [
    ...decomposed.itemHints,
    ...(profile?.items || []),
    ...extractItemHints(intent),
  ].filter(Boolean);

  const termSources = [
    ...queries,
    profile?.item,
    profile?.color,
    ...hints,
  ].filter(Boolean) as string[];
  let terms = queryTerms(termSources.join(" ") || intent, profile, hints);
  const userAskedHackathon = /\bhackathon\b/i.test(
    [intent, ...queries].join(" "),
  );
  if (!userAskedHackathon) {
    terms = terms.filter((t) => t !== "hackathon");
  }

  const res = await fetch("/api/market", { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Market search failed (HTTP ${res.status})`);
  }
  const data = (await res.json()) as MarketPayload;
  let products = data.products ?? [];

  const exclude = new Set(
    (opts?.excludeSkuIds || []).map((id) => id.toLowerCase()),
  );
  if (exclude.size) {
    products = products.filter(
      (p) =>
        !exclude.has(p.id.toLowerCase()) &&
        !exclude.has(`${p.storeSlug}:${p.id}`.toLowerCase()),
    );
  }

  const budgetMax = parseBudgetMax(profile);
  if (budgetMax != null) {
    products = products.filter((p) => {
      const price = Number(p.price);
      return !Number.isFinite(price) || price <= budgetMax;
    });
  }

  const quarantined = quarantineCatalog(products);
  const qByKey = new Map<string, QuarantinedSku>();
  for (const q of quarantined) {
    qByKey.set(`${q.storeSlug}:${q.id}`, q);
  }

  const demoIntent = wantsInjectionDemo(intent, queries);
  const flaggedSeen = new Map<string, QuarantinedSku>();
  const scored = new Map<string, MarketProductPick>();
  const sizing = opts?.sizing;

  for (const product of products) {
    const key = `${product.storeSlug}:${product.id}`;
    const q = qByKey.get(key);
    if (!q) continue;
    const base = scoreProduct(product, q, terms);
    considerPick(
      scored,
      flaggedSeen,
      product,
      q,
      base > 0 ? base + sizingBoost(product, q, sizing) : 0,
      demoIntent,
    );
  }

  // Per-query pass so "shirt" + "pants" each get strong role hits
  if (queries.length > 1) {
    for (const qText of queries) {
      const qTerms = queryTerms(qText, profile).filter(
        (t) => userAskedHackathon || t !== "hackathon",
      );
      const ranked: Array<{
        p: MarketApiProduct;
        q: QuarantinedSku;
        score: number;
      }> = [];
      for (const p of products) {
        const q = qByKey.get(`${p.storeSlug}:${p.id}`);
        if (!q) continue;
        const base = scoreProduct(p, q, qTerms);
        if (base <= 0) continue;
        ranked.push({
          p,
          q,
          score: base + sizingBoost(p, q, sizing),
        });
      }
      ranked.sort((a, b) => b.score - a.score);
      for (const { p, q, score } of ranked.slice(0, 3)) {
        considerPick(scored, flaggedSeen, p, q, score + 12, demoIntent);
      }
    }
  }

  for (const q of quarantined) {
    if (q.injectionFlags.length) {
      flaggedSeen.set(`${q.storeSlug}:${q.id}`, q);
    }
  }

  let picks = [...scored.values()].sort((a, b) => b.score - a.score);

  if (picks.length > 1) {
    const top = picks[0]!.score;
    const floor = Math.max(18, top * 0.35);
    picks = picks.filter((p) => p.score >= floor);
  }

  const limit = queries.length > 1 ? 6 : 5;
  const outfitFirst = diversifyOutfitPicks(picks, queries, qByKey);
  picks = (
    queries.length > 1 ? outfitFirst : diversifyByStore(outfitFirst, limit)
  ).slice(0, limit);

  if (picks.length === 0 && terms.length > 0) {
    for (const product of products) {
      const key = `${product.storeSlug}:${product.id}`;
      const q = qByKey.get(key);
      if (!q) continue;
      if (!q.safeForFashionRank && !demoIntent) continue;
      const hay = normalize(`${product.id} ${rankTitle(product, q)}`);
      if (terms.some((t) => hay.includes(t))) {
        picks.push(toPick(product, q, 25));
      }
    }
    picks = diversifyByStore(
      picks.sort((a, b) => b.score - a.score),
      limit,
    ).slice(0, limit);
  }

  const flagged = [...flaggedSeen.values()];
  const storeSlugs = [
    ...new Set([
      ...picks.map((p) => p.storeSlug),
      ...flagged.map((f) => f.storeSlug),
    ]),
  ];

  return { picks, flagged, decomposed, storeSlugs };
}

function apparelRole(title: string): "top" | "bottom" | "outer" | "other" {
  const t = normalize(title);
  if (/\b(jeans?|pants?|trousers?|shorts?|skirts?|chinos?)\b/.test(t)) {
    return "bottom";
  }
  if (/\b(coats?|blazers?|jackets?|overcoat)\b/.test(t)) return "outer";
  if (
    /\b(shirts?|tees?|tshirts?|blouses?|tops?|crews?|sweaters?|hoodies?)\b/.test(
      t,
    )
  ) {
    return "top";
  }
  return "other";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-token size match in normalized haystack (titles often `… / M` or `30x32`). */
function sizeTokenInHay(hay: string, token: string): boolean {
  const t = token.trim().toLowerCase();
  if (!t) return false;
  if (t.includes("x")) {
    return hay.includes(t) || hay.includes(t.replace(/x/g, " x "));
  }
  return new RegExp(
    `(?:^|[^a-z0-9])${escapeRegExp(t)}(?:[^a-z0-9]|$)`,
  ).test(hay);
}

function garmentKind(title: string): "top" | "bottom" | "shoe" | "other" {
  const t = normalize(title);
  if (/\b(shoes?|sneakers?|runners?|hikers?|trainers?|boots?|loafers?)\b/.test(t)) {
    return "shoe";
  }
  const role = apparelRole(title);
  if (role === "top" || role === "bottom") return role;
  return "other";
}

/** Soft boost when listing size matches buyer prefs — never filters out misses. */
function sizingBoost(
  product: MarketApiProduct,
  q: QuarantinedSku,
  sizing?: BuyerSizingPrefs | null,
): number {
  if (!sizing) return 0;
  const title = rankTitle(product, q);
  const hay = normalize(`${product.id} ${title} ${product.description || ""}`);
  const kind = garmentKind(title);
  let bonus = 0;

  if (sizing.tops && sizeTokenInHay(hay, sizing.tops.toLowerCase())) {
    if (kind === "top") bonus += 35;
    else if (/\b(shirt|tee|tshirt|blouse|top|crew|sweater|hoodie)\b/.test(hay)) {
      bonus += 35;
    }
  }
  if (sizing.bottoms && sizeTokenInHay(hay, sizing.bottoms)) {
    if (kind === "bottom") bonus += 35;
    else if (/\b(jean|pant|trouser|chino|short|skirt)\b/.test(hay)) {
      bonus += 35;
    }
  }
  if (sizing.shoes && kind === "shoe" && sizeTokenInHay(hay, sizing.shoes)) {
    bonus += 35;
  }
  return bonus;
}

function diversifyOutfitPicks(
  picks: MarketProductPick[],
  queries: string[],
  qByKey: ReadonlyMap<string, QuarantinedSku>,
): MarketProductPick[] {
  const wantsBottom = queries.some((q) =>
    /\b(pant|jean|trouser|short|skirt|chino)\b/i.test(q),
  );
  const wantsTop = queries.some((q) =>
    /\b(shirt|tee|blouse|top)\b/i.test(q),
  );
  if (!wantsBottom && !wantsTop) return picks;
  if (picks.length <= 1) return picks;

  const roleOf = (p: MarketProductPick) => {
    const q = qByKey.get(p.id);
    const title =
      q && !q.safeForFashionRank ? q.displayTitle : p.title;
    return apparelRole(title);
  };

  const tops = picks.filter((p) => roleOf(p) === "top");
  const bottoms = picks.filter((p) => roleOf(p) === "bottom");
  const outers = picks.filter((p) => roleOf(p) === "outer");
  const others = picks.filter((p) => roleOf(p) === "other");

  const out: MarketProductPick[] = [];
  const push = (p?: MarketProductPick) => {
    if (!p) return;
    if (out.some((x) => x.id === p.id)) return;
    out.push(p);
  };

  if (wantsTop) push(tops[0]);
  if (wantsBottom) push(bottoms[0] || outers[0]);
  if (out.length < 2) {
    push(outers[0]);
    push(tops[1]);
    push(bottoms[1]);
  }

  for (const pool of [tops, bottoms, outers, others, picks]) {
    for (const pick of pool) {
      push(pick);
      if (out.length >= 6) return out;
    }
  }
  return out;
}

function diversifyByStore(
  picks: MarketProductPick[],
  limit: number,
): MarketProductPick[] {
  if (picks.length <= 2) return picks;
  const out: MarketProductPick[] = [];
  const seenStores = new Set<string>();
  for (const pick of picks) {
    if (seenStores.has(pick.storeSlug)) continue;
    out.push(pick);
    seenStores.add(pick.storeSlug);
    if (out.length >= limit) return out;
  }
  for (const pick of picks) {
    if (out.some((p) => p.id === pick.id)) continue;
    out.push(pick);
    if (out.length >= limit) break;
  }
  return out;
}

export { formatFlagSummary };
