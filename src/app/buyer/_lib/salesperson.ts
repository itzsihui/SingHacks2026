export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type FashionProfile = {
  category?: string;
  item?: string;
  /** Multiple catalog targets for sets (e.g. shirt + pants). */
  items?: string[];
  style?: string;
  color?: string;
  budget?: string;
  occasion?: string;
};

export type SalespersonResult = {
  reply: string;
  suggestions?: string[];
  status: "clarifying" | "ready";
  searchQuery?: string;
  /** Extra catalog queries for multi-SKU outfits. */
  searchQueries?: string[];
  /** LLM reasoning lines — shown in expandable Thought process (never invent catalog hits). */
  thoughts?: string[];
  profile?: FashionProfile;
  llm: "openai" | "bedrock" | "deterministic";
};

const SYSTEM = `You are Borneo's fashion buyer salesperson — a warm, sharp personal shopper for apparel sold by merchants on the Borneo network.

You search LIVE seller catalogs later (registry + each store's products). Never invent SKUs, prices, or stock.

Think like a salesperson in a store — reason from CONTEXT, not a fixed keyword list:
- Read the FULL conversation and fix obvious typos (presetn→presentation, profesional→professional, gona→gonna, hwo→how).
- Meta / how-to first. If they ask how this works, what you do, or greet without naming clothes ("hi", "hello", "how does this work"), stay status "clarifying". Briefly explain the flow (chat → clarify → search live catalogs → pick → pay Visa/RLUSD) and ask what they want to wear. Do NOT invent an occasion or search.
- Never treat the verb "work" in "how does this work" / "does it work" as a work/office outfit.
- Infer occasion + vibe dynamically from what they said (party, date, interview, beach, weekend, wedding, gym, … — open-ended). Put the inferred occasion in profile.occasion (short free text).
- From that context, infer what garment *roles* fit (statement top, full set top+bottoms, dress, polished shirt+pants, etc.). Never blindly default to "tee".
- Occasion-only / vibe-only asks ("going to a party", "something for the weekend"): prefer status "clarifying" with ONE short question (full set vs one piece, or casual vs dressier) unless they already named garments or said set/outfit/look. At most 1–2 clarifying questions total.
- Clear single item ("a tee", "jeans") → status "ready"; search that item; do not over-ask.
- When ready: SHORT catalog nouns merchants would list (shirt, pants, jeans, dress, blouse…) — NOT the user's full sentence. For complementary looks: searchQuery like "shirt pants", searchQueries ["shirt","pants","jeans"]. Include jeans when hunting bottoms.
- thoughts (required, 2–5 lines): first-person reasoning about THIS ask — what occasion/vibe you inferred and why those garment roles. Do NOT claim you already found products. Example kind: "Party → festive/casual; complementary top + bottoms makes sense."
- Fill profile.style / profile.items from your inference when known.

Respond ONLY with JSON:
{"reply":"string","suggestions":["chip1","chip2"],"status":"clarifying"|"ready","searchQuery":"optional","searchQueries":["optional"],"thoughts":["…"],"profile":{"category":"fashion","item":"","items":[],"style":"","color":"","budget":"","occasion":""}}`;

function userTurnCount(messages: ChatMessage[]) {
  return messages.filter((m) => m.role === "user").length;
}

function lastUser(messages: ChatMessage[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") return messages[i]!.content;
  }
  return "";
}

function lastAssistant(messages: ChatMessage[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "assistant") return messages[i]!.content;
  }
  return "";
}

function userCorpusText(messages: ChatMessage[]) {
  return messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join(" ");
}

/** Common fashion typos before regex intent detection. */
function normalizeFashionTypos(text: string) {
  return text
    .toLowerCase()
    .replace(/\bgng\b/g, "going")
    .replace(/\bgona\b/g, "gonna")
    .replace(/\bpresntaiton\b/g, "presentation")
    .replace(/\bpresentaion\b/g, "presentation")
    .replace(/\bpresenation\b/g, "presentation")
    .replace(/\bpresentaton\b/g, "presentation")
    .replace(/\bprofesional\b/g, "professional")
    .replace(/\binterveiw\b/g, "interview");
}

function normalizeQuestion(text: string) {
  return normalizeFashionTypos(text)
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** LLM often re-asks this even after the user named a tee/cap. */
function isUselessClarify(text: string) {
  const n = normalizeQuestion(text);
  if (!n) return false;
  return (
    n.includes("type of apparel") ||
    n.includes("kind of apparel") ||
    n.includes("what apparel") ||
    /\bwhat (?:are you|do you)\b.*\blooking for\b/.test(n) ||
    /\bwhat type of\b/.test(n) ||
    /\bwhat kind of\b/.test(n)
  );
}

function detectItem(
  text: string,
): "tee" | "cap" | "compare" | "pants" | "outfit" | "unknown" {
  const t = normalizeFashionTypos(text).replace(/t\s+shirt/g, "tshirt");
  if (/\b(compare|vs|versus)\b/.test(t) && /\b(shirt|tee|cap|hat|tshirt)\b/.test(t)) {
    return "compare";
  }
  // Explicit set / work-occasion garments — not bare "date" (that clarifies first)
  if (
    /\b(outfit|full\s+look|ensemble)\b/.test(t) ||
    /\b((a|the|full|complete)\s+set)\b/.test(t) ||
    /\b(set\s+for|find\s+me\s+a\s+set|want\s+a\s+set|need\s+a\s+set)\b/.test(t) ||
    /\b(date[- ]?night\s+set|full\s+set)\b/.test(t) ||
    (/\bset\b/.test(t) &&
      /\b(date|dinner|night|look|wear|clothes|outfit)\b/.test(t)) ||
    (/\b(shirt|blouse|top)\b/.test(t) && /\b(pants?|trousers?|jeans)\b/.test(t)) ||
    /\b(present(?:ation)?|interview|meeting|professional|formal|office)\b/.test(
      t,
    ) ||
    isWorkOutfitAsk(t)
  ) {
    return "outfit";
  }
  if (/\b(pants?|jeans|trousers?)\b/.test(t)) return "pants";
  if (/\b(cap|hat)\b/.test(t)) return "cap";
  if (/\b(t-?shirt|tshirt|tee|shirt|blouse)\b/.test(t)) return "tee";
  return "unknown";
}

/** "for work" / workwear — not the verb in "how does this work". */
function isWorkOutfitAsk(text: string): boolean {
  const t = text.toLowerCase();
  if (isMetaHelpAsk(t)) return false;
  return (
    /\bworkwear\b/.test(t) ||
    /\b(?:for|to|at)\s+work\b/.test(t) ||
    /\bwork\s+(?:outfit|clothes|wear|look|attire|event)\b/.test(t) ||
    /\b(?:outfit|clothes|wear|look)\s+for\s+work\b/.test(t)
  );
}

/** Greetings / product-flow questions — stay in guided chat, do not search. */
function isMetaHelpAsk(text: string): boolean {
  const t = normalizeQuestion(text);
  if (!t) return false;

  // Tolerate common typos: hwo/hoe → how
  const fixed = t.replace(/\b(hwo|hoe|hw)\b/g, "how");

  if (
    /\bhow (?:does|do|is) (?:this|it|the(?:se)?|your) (?:work|app|agent|chat|flow)\b/.test(
      fixed,
    ) ||
    /\b(?:does|did) (?:this|it) work\b/.test(fixed) ||
    /\bhow (?:do i|to) (?:use|start|pay|buy|shop|search)\b/.test(fixed) ||
    /\bwhat (?:is|does) (?:this|the) (?:agent|app|chat|buyer)\b/.test(fixed) ||
    /\bexplain (?:this|how|the)\b/.test(fixed) ||
    /^(?:help|what can you do|how does this work|how do i use this)$/.test(
      fixed,
    )
  ) {
    return true;
  }

  // Greeting alone, or greeting + how-it-works — not a fashion ask
  if (
    /^(hi|hey|hello|yo|sup|hiya|howdy)(?:\s|$)/.test(fixed) &&
    !/\b(tee|tshirt|shirt|cap|hat|pants|jeans|outfit|dress|looking for)\b/.test(
      fixed,
    )
  ) {
    if (
      /^(hi|hey|hello|yo|sup|hiya|howdy)$/.test(fixed) ||
      /\bhow (?:does|do|is) (?:this|it)\b/.test(fixed) ||
      /\b(?:does|did) (?:this|it) work\b/.test(fixed) ||
      /\bwhat (?:is|does) (?:this|it)\b/.test(fixed) ||
      /\bhelp\b/.test(fixed) ||
      /\bexplain\b/.test(fixed)
    ) {
      return true;
    }
  }
  return false;
}

function detectOccasion(text: string): string | undefined {
  const t = normalizeFashionTypos(text);
  if (isMetaHelpAsk(t)) return undefined;
  // Work/presentation before date — "date or presentation" in suggestions must not win
  if (
    /\b(present(?:ation)?|interview|meeting|office)\b/.test(t) ||
    isWorkOutfitAsk(t)
  ) {
    return "work";
  }
  if (/\b(date|dinner|night\s+out|going\s+out)\b/.test(t)) return "date";
  return undefined;
}

function detectStyle(text: string): string | undefined {
  const t = normalizeFashionTypos(text);
  if (isMetaHelpAsk(t)) return undefined;
  if (
    /\b(professional|formal|office|present(?:ation)?|interview|meeting)\b/.test(
      t,
    ) ||
    isWorkOutfitAsk(t)
  ) {
    return "professional";
  }
  if (/\b(date|dinner|night\s+out)\b/.test(t)) return "date";
  if (/\bcasual\b/.test(t)) return "casual";
  if (/\bgraphic\b/.test(t)) return "graphic";
  if (/\bplain\b/.test(t)) return "plain";
  if (/\boversized\b/.test(t)) return "oversized";
  if (/\bstreet\b/.test(t)) return "streetwear";
  return undefined;
}

const META_HELP_REPLY =
  "You chat with me like a salesperson — tell me the occasion or piece you want, I clarify if needed, then I search live seller catalogs on Borneo. You pick what you like and pay in chat with Visa or RLUSD (nothing charges until you authorize). What are you looking to wear?";

const META_HELP_SUGGESTIONS = [
  "I want a t-shirt",
  "Looking for a cap",
  "Need a presentation outfit",
  "Date-night set",
];

function wantsExplicitSet(text: string): boolean {
  const t = text.toLowerCase();
  return (
    /\b(outfit|full\s+look|ensemble)\b/.test(t) ||
    /\b((a|the|full|complete)\s+set)\b/.test(t) ||
    /\b(find\s+me\s+a\s+set|want\s+a\s+set|need\s+a\s+set)\b/.test(t) ||
    /\b(date[- ]?night\s+set|night\s+set|full\s+set)\b/.test(t) ||
    /\bset\b/.test(t)
  );
}

/** Vague dressing context without a named SKU — for fallback clarify, not a closed occasion map. */
function isVagueOccasionAsk(text: string): boolean {
  const t = normalizeQuestion(text);
  if (!t || isMetaHelpAsk(t)) return false;
  if (detectItem(t) !== "unknown") return false;
  return (
    /\b(?:what|wht)\s+(?:to|should i)\s+wear\b/.test(t) ||
    /\b(?:going|gonna|might be|headed)\b/.test(t) ||
    /\b(?:need|want|looking for)\s+something\b/.test(t) ||
    /\b(?:outfit|clothes|wear|look)\s+for\b/.test(t) ||
    /\bfor\s+(?:a|the|my)\s+\w+/.test(t) ||
    Boolean(detectOccasion(t))
  );
}

/** Weak default hunts that ignore occasion context. */
function isWeakDefaultHunt(q?: string, queries?: string[]): boolean {
  const parts = [q, ...(queries || [])]
    .filter(Boolean)
    .map((s) => s!.trim().toLowerCase());
  if (!parts.length) return true;
  const joined = parts.join(" ");
  if (/^fashion\s+apparel$/.test(joined)) return true;
  if (/^(tee|t-?shirt)$/.test(joined)) return true;
  if (/^shirt\s+tee$/.test(joined)) return true;
  if (
    parts.length <= 2 &&
    parts.every((p) => /^(shirt|tee|t-?shirt)$/.test(p)) &&
    !parts.some((p) => /pants|jeans|dress|blouse/.test(p))
  ) {
    return true;
  }
  return false;
}

/** True when searchQuery is still the user's chat utterance, not catalog terms. */
function looksLikeRawUtterance(q: string): boolean {
  const t = q.trim();
  if (!t) return true;
  if (t.split(/\s+/).length > 6) return true;
  return /\b(i|im|i'm|wanna|want to|have to|gonna|looking for|might be)\b/i.test(
    t,
  );
}

const COMPLEMENTARY_SET = {
  searchQuery: "shirt pants jeans",
  searchQueries: ["shirt", "pants", "jeans"],
} as const;

function catalogSearchFromProfile(
  messages: ChatMessage[],
  profile?: FashionProfile,
): { searchQuery: string; searchQueries: string[] } {
  const corpus = userCorpusText(messages);
  const item = detectItem(corpus);
  const style = profile?.style || detectStyle(corpus);

  if (profile?.items && profile.items.length > 0) {
    return {
      searchQuery: profile.items.join(" "),
      searchQueries: profile.items.slice(0, 4),
    };
  }

  // Occasion / vibe from LLM or regex — complementary set, never bare tee
  if (
    profile?.occasion ||
    style === "professional" ||
    style === "date" ||
    item === "outfit"
  ) {
    return {
      searchQuery: COMPLEMENTARY_SET.searchQuery,
      searchQueries: [...COMPLEMENTARY_SET.searchQueries],
    };
  }

  if (item === "cap" || profile?.item === "cap") {
    return { searchQuery: "cap", searchQueries: ["cap"] };
  }
  if (item === "pants" || profile?.item === "pants") {
    return { searchQuery: "pants jeans", searchQueries: ["pants", "jeans"] };
  }
  if (item === "compare" || profile?.item?.includes("vs")) {
    return { searchQuery: "shirt", searchQueries: ["shirt", "cap"] };
  }
  if (item === "tee" || profile?.item === "tee" || profile?.item === "shirt") {
    if (style === "graphic") {
      return { searchQuery: "graphic tee", searchQueries: ["graphic tee"] };
    }
    if (style === "plain") {
      return { searchQuery: "plain tee", searchQueries: ["plain tee"] };
    }
    return { searchQuery: "shirt tee", searchQueries: ["shirt", "tee"] };
  }

  const fromProfile = [profile?.item, profile?.style, profile?.color]
    .filter(Boolean)
    .join(" ")
    .trim();
  if (fromProfile && !/^tee$/i.test(fromProfile)) {
    return { searchQuery: fromProfile, searchQueries: [fromProfile] };
  }

  // No occasion, no item — complementary apparel bias (not tee-only)
  return {
    searchQuery: COMPLEMENTARY_SET.searchQuery,
    searchQueries: [...COMPLEMENTARY_SET.searchQueries],
  };
}

function inferSearchQuery(
  messages: ChatMessage[],
  profile?: FashionProfile,
): string {
  return catalogSearchFromProfile(messages, profile).searchQuery;
}

function enrichProfile(
  messages: ChatMessage[],
  profile?: FashionProfile,
): FashionProfile {
  const corpus = userCorpusText(messages);
  const item = detectItem(corpus);
  const style = detectStyle(corpus);
  const occasion = detectOccasion(corpus);
  const lower = corpus.toLowerCase();
  const next: FashionProfile = {
    category: "fashion",
    ...profile,
  };
  // Latest user-inferred occasion wins over a stale/wrong profile.occasion
  if (occasion) next.occasion = occasion;
  if (!next.item) {
    next.item =
      item === "cap"
        ? "cap"
        : item === "compare"
          ? "shirt vs cap"
          : item === "pants"
            ? "pants"
            : item === "outfit"
              ? "shirt and pants"
              : item === "tee"
                ? "tee"
                : profile?.item;
  }
  if (style) next.style = style;
  if (
    !next.items?.length &&
    (item === "outfit" ||
      style === "professional" ||
      wantsExplicitSet(corpus) ||
      (occasion === "date" && wantsExplicitSet(corpus)))
  ) {
    next.items = ["shirt", "pants", "jeans"];
  }
  if (!next.color) {
    const color = lower.match(
      /\b(black|white|navy|blue|red|green|grey|gray|beige|cream|brown)\b/,
    );
    if (color) next.color = color[1];
  }
  if (!next.budget) {
    // Require a budget keyword or a digit-led amount — never capture a lone "."
    const budget = lower.match(
      /\b(?:under|below|max|budget)\s*([\d]+(?:\.\d+)?)\s*(usdc|xsgd|usd|sgd|rlusd)?\b/,
    );
    if (budget) {
      next.budget = `${budget[1]} ${(budget[2] || "RLUSD").toUpperCase()}`;
    }
  }
  return next;
}

/**
 * Thin rails only: meta-help, anti-loop, preserve LLM occasion reasoning.
 * Do not stomp clarifying vibes into a blind tee hunt.
 */
export function ensureConversationProgress(
  messages: ChatMessage[],
  result: SalespersonResult,
): SalespersonResult {
  const turns = userTurnCount(messages);
  const corpus = userCorpusText(messages);
  const latest = lastUser(messages);
  const item = detectItem(corpus);
  const profile = enrichProfile(messages, result.profile);
  const prevAsk = lastAssistant(messages);
  const uselessNow = isUselessClarify(result.reply);
  const repeated =
    result.status === "clarifying" &&
    Boolean(prevAsk) &&
    (normalizeQuestion(result.reply) === normalizeQuestion(prevAsk) ||
      (isUselessClarify(result.reply) && isUselessClarify(prevAsk)) ||
      (normalizeQuestion(result.reply).includes("casual") &&
        normalizeQuestion(result.reply).includes("formal") &&
        normalizeQuestion(prevAsk).includes("casual") &&
        normalizeQuestion(prevAsk).includes("formal")));

  // "how does this work" / bare hi — never jump to catalog search
  if (isMetaHelpAsk(latest)) {
    return {
      ...result,
      status: "clarifying",
      searchQuery: undefined,
      searchQueries: undefined,
      reply: META_HELP_REPLY,
      suggestions: META_HELP_SUGGESTIONS,
      thoughts: [
        "They asked how the buyer flow works — not for a specific garment yet.",
        "Explain chat → clarify → search catalogs → pay, then ask what they want.",
      ],
      profile: { category: "fashion" },
      llm: result.llm,
    };
  }

  const forceReady = () => {
    const catalog = catalogSearchFromProfile(messages, profile);
    const useLlmQuery =
      result.searchQuery &&
      !looksLikeRawUtterance(result.searchQuery) &&
      !isWeakDefaultHunt(result.searchQuery, result.searchQueries);
    return {
      ...result,
      status: "ready" as const,
      searchQuery: useLlmQuery ? result.searchQuery : catalog.searchQuery,
      searchQueries:
        useLlmQuery && result.searchQueries?.length
          ? result.searchQueries
          : catalog.searchQueries,
      thoughts: result.thoughts?.length
        ? result.thoughts
        : [
            `Reading: “${lastUser(messages).slice(0, 120)}”`,
            profile.occasion
              ? `Occasion “${profile.occasion}” → complementary catalog hunt: ${catalog.searchQuery}`
              : `Mapped to catalog hunt: ${catalog.searchQuery}`,
          ],
      profile,
      suggestions: [] as string[],
      reply:
        result.reply && !/found|here'?s what/i.test(result.reply)
          ? result.reply
          : "I'll search seller catalogs on the Borneo network for that now.",
    };
  };

  if (result.status === "ready") {
    const catalog = catalogSearchFromProfile(messages, profile);
    const rawQ = result.searchQuery?.trim() || "";
    const llmQueries = result.searchQueries?.filter(
      (q) => q.trim() && !looksLikeRawUtterance(q),
    );
    const weak =
      looksLikeRawUtterance(rawQ) ||
      isWeakDefaultHunt(rawQ, llmQueries) ||
      !rawQ;
    // Occasion context must not collapse to shirt+tee
    const upgradeForOccasion =
      Boolean(profile.occasion || profile.items?.length) &&
      isWeakDefaultHunt(rawQ, llmQueries);

    const searchQuery =
      !weak && !upgradeForOccasion ? rawQ : catalog.searchQuery;
    const searchQueries =
      llmQueries?.length && !upgradeForOccasion && !isWeakDefaultHunt(rawQ, llmQueries)
        ? llmQueries
        : catalog.searchQueries;

    const nextProfile =
      profile.items?.length || !profile.occasion
        ? profile
        : {
            ...profile,
            items: searchQueries.slice(0, 4),
            item: profile.item || searchQueries.slice(0, 2).join(" and "),
          };

    return {
      ...result,
      profile: nextProfile,
      searchQuery,
      searchQueries,
      thoughts: result.thoughts?.length
        ? result.thoughts
        : [
            nextProfile.occasion
              ? `Inferred occasion: ${nextProfile.occasion}`
              : `Intent → catalog terms: ${searchQuery}`,
            searchQueries.length > 1
              ? `Hunting complementary pieces: ${searchQueries.join(" + ")}`
              : `Scanning merchant products for “${searchQuery}”`,
          ],
      suggestions: [],
    };
  }

  // Preserve clarifying when vibe/occasion is underspecified — don't forceReady into tee
  if (
    result.status === "clarifying" &&
    item === "unknown" &&
    turns <= 2 &&
    !uselessNow &&
    !wantsExplicitSet(corpus) &&
    (result.llm !== "deterministic" ||
      Boolean(profile.occasion) ||
      Boolean(result.thoughts?.length) ||
      isVagueOccasionAsk(latest) ||
      Boolean(detectOccasion(corpus)))
  ) {
    return { ...result, profile };
  }

  // Named garment / explicit set → search
  if (item !== "unknown") {
    return forceReady();
  }

  if (repeated || turns >= 3 || uselessNow) {
    return forceReady();
  }

  return { ...result, profile };
}

function parseJsonResult(raw: string): SalespersonResult | null {
  const trimmed = raw.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence?.[1]?.trim() || trimmed;
  try {
    const data = JSON.parse(body) as Partial<SalespersonResult> & {
      thoughts?: unknown;
      searchQueries?: unknown;
    };
    if (!data.reply || (data.status !== "clarifying" && data.status !== "ready")) {
      return null;
    }
    return {
      reply: String(data.reply),
      suggestions: Array.isArray(data.suggestions)
        ? data.suggestions.map(String).slice(0, 4)
        : undefined,
      status: data.status,
      searchQuery: data.searchQuery ? String(data.searchQuery) : undefined,
      searchQueries: Array.isArray(data.searchQueries)
        ? data.searchQueries.map(String).filter(Boolean).slice(0, 4)
        : undefined,
      thoughts: Array.isArray(data.thoughts)
        ? data.thoughts.map(String).filter(Boolean).slice(0, 6)
        : undefined,
      profile: data.profile,
      llm: "openai",
    };
  } catch {
    return null;
  }
}

/** Demo-safe scripted fashion Q&A when no LLM keys. */
export function runDeterministicSalesperson(
  messages: ChatMessage[],
): SalespersonResult {
  const turns = userTurnCount(messages);
  const latest = lastUser(messages);
  const userCorpus = userCorpusText(messages);
  const item = detectItem(userCorpus);
  const lower = normalizeFashionTypos(latest);
  const style = detectStyle(userCorpus);
  const occasionNow = detectOccasion(userCorpus);

  const profile = enrichProfile(messages, {
    category: "fashion",
    item:
      item === "cap"
        ? "cap"
        : item === "compare"
          ? "shirt vs cap"
          : item === "pants"
            ? "pants"
            : item === "outfit"
              ? "shirt and pants"
              : item === "tee"
                ? "tee"
                : undefined,
    items: item === "outfit" ? ["shirt", "pants", "jeans"] : undefined,
    style,
    occasion: occasionNow,
  });

  if (/\b(graphic|plain|oversized|black|white|budget|under|0\.0|professional|formal)/i.test(lower)) {
    if (/\bgraphic\b/i.test(lower)) profile.style = "graphic";
    if (/\bplain\b/i.test(lower)) profile.style = "plain";
    if (/\boversized\b/i.test(lower)) profile.style = "oversized";
    if (/\b(professional|formal)\b/i.test(lower)) profile.style = "professional";
    if (/\bblack\b/i.test(lower)) profile.color = "black";
    if (/\bwhite\b/i.test(lower)) profile.color = "white";
    const budget = lower.match(/under\s+([\d]+(?:\.\d+)?)\s*(usdc|xsgd|usd|rlusd)?/i);
    if (budget) profile.budget = `${budget[1]} ${(budget[2] || "RLUSD").toUpperCase()}`;
  }

  if (turns === 0 || (!latest && turns <= 1)) {
    return {
      reply:
        "Hey — I'm your fashion buyer agent. What are you looking to wear today?",
      suggestions: [
        "I want a t-shirt",
        "Looking for a cap",
        "Need a presentation outfit",
      ],
      status: "clarifying",
      profile,
      llm: "deterministic",
    };
  }

  if (isMetaHelpAsk(latest)) {
    return {
      reply: META_HELP_REPLY,
      suggestions: META_HELP_SUGGESTIONS,
      status: "clarifying",
      thoughts: [
        "They asked how this works — keep it conversational, no catalog hunt yet.",
      ],
      profile: { category: "fashion" },
      llm: "deterministic",
    };
  }

  if (item === "outfit" && turns >= 1) {
    const catalog = catalogSearchFromProfile(messages, profile);
    const isDate =
      (profile.occasion || occasionNow) === "date" || style === "date";
    const isWork =
      (profile.occasion || occasionNow) === "work" || style === "professional";
    return ensureConversationProgress(messages, {
      reply: isDate
        ? "Date night — I'll pull a top + bottoms set from seller catalogs."
        : isWork
          ? "Presentation / work look — I'll pull a polished top + bottoms from seller catalogs."
          : "Got it — I'll look across seller catalogs for a complementary top + bottoms set.",
      suggestions: [],
      status: "ready",
      searchQuery: catalog.searchQuery,
      searchQueries: catalog.searchQueries,
      thoughts: [
        isDate
          ? "They're dressing for a date and asked for a set."
          : isWork
            ? "Occasion is a presentation/work — polished complementary pieces, not a casual tee."
            : "They want a full look, not a single SKU.",
        "Hunting complementary pieces: shirt + pants/jeans across merchants.",
      ],
      profile: {
        ...profile,
        item: "shirt and pants",
        items: ["shirt", "pants", "jeans"],
        occasion:
          profile.occasion ||
          occasionNow ||
          (isDate ? "date" : isWork ? "work" : profile.occasion),
        style:
          profile.style ||
          (isDate ? "date" : isWork ? "professional" : profile.style),
      },
      llm: "deterministic",
    });
  }

  // Follow-up after occasion ask: "Full set" / "Date-night set" / piece / dressier
  if (turns >= 2 && item === "unknown") {
    const follow = normalizeFashionTypos(lastUser(messages));
    const priorOccasion =
      profile.occasion || detectOccasion(userCorpus);
    if (
      wantsExplicitSet(userCorpus) ||
      /\bfull\s+set\b/i.test(follow)
    ) {
      const catalog = catalogSearchFromProfile(messages, {
        ...profile,
        items: ["shirt", "pants", "jeans"],
        occasion: priorOccasion,
      });
      const isDate = priorOccasion === "date";
      const isWork = priorOccasion === "work";
      return ensureConversationProgress(messages, {
        reply: isDate
          ? "Perfect — searching seller catalogs for a date-night top + bottoms."
          : isWork
            ? "Perfect — searching seller catalogs for a polished presentation set."
            : "Perfect — searching seller catalogs for a complementary set.",
        suggestions: [],
        status: "ready",
        searchQuery: catalog.searchQuery,
        searchQueries: catalog.searchQueries,
        thoughts: [
          priorOccasion
            ? `They confirmed a full set for “${priorOccasion}”.`
            : "They confirmed they want a full set.",
          "I'll rank shirts/tops and pants/jeans across merchants.",
        ],
        profile: {
          ...profile,
          item: "shirt and pants",
          items: ["shirt", "pants", "jeans"],
          occasion: priorOccasion || profile.occasion,
        },
        llm: "deterministic",
      });
    }
    if (/\bdressier|dress\b/i.test(follow)) {
      return ensureConversationProgress(messages, {
        reply: "On it — searching for dressier options across seller catalogs.",
        suggestions: [],
        status: "ready",
        searchQuery: "dress shirt",
        searchQueries: ["dress", "shirt"],
        thoughts: [
          priorOccasion
            ? `Dressier lean for “${priorOccasion}”.`
            : "They want something dressier than a basic tee.",
          "Hunting dresses and polished tops across merchants.",
        ],
        profile: {
          ...profile,
          item: "dress",
          items: ["dress", "shirt"],
          style: profile.style || "dressier",
          occasion: priorOccasion || profile.occasion,
        },
        llm: "deterministic",
      });
    }
    if (/\bjust a (top|shirt|tee|piece)|one piece|only a\b/i.test(follow)) {
      return ensureConversationProgress(messages, {
        reply: "Got it — searching seller catalogs for a statement top.",
        suggestions: [],
        status: "ready",
        searchQuery: "shirt tee",
        searchQueries: ["shirt", "tee"],
        thoughts: [
          "They want a single piece, not a full set.",
          "Hunting shirts/tees across merchants.",
        ],
        profile: {
          ...profile,
          item: "shirt",
          items: ["shirt", "tee"],
          occasion: priorOccasion || profile.occasion,
        },
        llm: "deterministic",
      });
    }
  }

  // Occasion / vague vibe without a named garment — one clarify (not a keyword→outfit table)
  const occasion = occasionNow || profile.occasion;
  if (
    (occasion || isVagueOccasionAsk(latest)) &&
    item === "unknown" &&
    turns === 1
  ) {
    const label = occasion || "that";
    if (occasion === "date") {
      return {
        reply:
          "Date night — nice. Want a full set (top + bottoms), or just one piece?",
        suggestions: ["Full set", "Just a shirt", "Jeans"],
        status: "clarifying",
        thoughts: [
          "Occasion is a date; a complementary set is a natural recommendation.",
          "Checking whether they want the full look or a single item before I search catalogs.",
        ],
        profile: {
          ...profile,
          occasion: "date",
          style: profile.style || "date",
        },
        llm: "deterministic",
      };
    }
    return {
      reply:
        occasion === "work"
          ? "For that, a polished top + bottoms usually works. Want a full set, or one piece?"
          : "Got it — sounds like you're dressing for something. Want a full set (top + bottoms), or just one piece?",
      suggestions: ["Full set", "Just a top", "Something dressier"],
      status: "clarifying",
      thoughts: [
        occasion
          ? `Inferred occasion: ${label} — complementary pieces usually work better than a random tee.`
          : "They're describing a vibe/occasion without naming a garment yet.",
        "Ask set vs one piece before hunting seller catalogs.",
      ],
      profile: {
        ...profile,
        ...(occasion ? { occasion } : {}),
      },
      llm: "deterministic",
    };
  }

  if (item === "unknown" && turns === 1) {
    return {
      reply:
        "Happy to help. Tee, cap, pants, or a full outfit for something like a date or presentation?",
      suggestions: ["A t-shirt", "A cap", "Date-night set", "Presentation outfit"],
      status: "clarifying",
      thoughts: [
        "Ask is still open-ended — need a garment or occasion before searching.",
      ],
      profile,
      llm: "deterministic",
    };
  }

  // Item known + any follow-up (casual, color, budget, "just show me") → search
  if (item !== "unknown" && turns >= 2) {
    return ensureConversationProgress(messages, {
      reply: "I'll search the Borneo network for that now.",
      suggestions: [],
      status: "ready",
      searchQuery: inferSearchQuery(messages, profile),
      profile,
      llm: "deterministic",
    });
  }

  if (item === "tee" && turns === 1) {
    // Skip apparel re-asks — go straight to catalog for clear item intents
    return ensureConversationProgress(messages, {
      reply: "I'll search the Borneo network for that now.",
      suggestions: [],
      status: "ready",
      searchQuery: inferSearchQuery(messages, profile),
      profile: { ...profile, item: "tee" },
      llm: "deterministic",
    });
  }

  if (item === "cap" && turns === 1) {
    return ensureConversationProgress(messages, {
      reply: "I'll search the Borneo network for a cap now.",
      suggestions: [],
      status: "ready",
      searchQuery: "cap",
      profile: { ...profile, item: "cap" },
      llm: "deterministic",
    });
  }

  if (item === "compare" && turns === 1) {
    return {
      reply:
        "I can compare tees and caps across seller catalogs. Prefer a budget under 0.02 RLUSD, or just show both?",
      suggestions: ["Under 0.02 RLUSD", "Show both", "Focus on the tee"],
      status: "clarifying",
      profile: { ...profile, item: "shirt vs cap" },
      llm: "deterministic",
    };
  }

  if (/\bpants?\b|\bjeans\b|\btrousers?\b/.test(userCorpus.toLowerCase()) && turns >= 2) {
    return {
      reply: "I'll search the Borneo network for pants now.",
      suggestions: [],
      status: "ready",
      searchQuery: "pants",
      profile: { ...profile, item: "pants" },
      llm: "deterministic",
    };
  }

  if (item === "cap" || /\bcap\b|\bhat\b/.test(lower)) {
    return {
      reply: "I'll search the Borneo network for a cap now.",
      suggestions: [],
      status: "ready",
      searchQuery: "cap",
      profile: { ...profile, item: "cap", color: profile.color || "black" },
      llm: "deterministic",
    };
  }

  if (item === "compare") {
    return {
      reply: "I'll search the Borneo network to compare tee and cap options.",
      suggestions: [],
      status: "ready",
      searchQuery: "shirt",
      profile: {
        ...profile,
        item: "shirt vs cap",
        budget: profile.budget || "0.02 RLUSD",
      },
      llm: "deterministic",
    };
  }

  // Fallback: complementary apparel across sellers — never pin to tee-only or one demo store.
  const catalog = catalogSearchFromProfile(messages, profile);
  const styleHint =
    profile.style ||
    (/\bgraphic\b/i.test(lower)
      ? "graphic"
      : /\bplain\b/i.test(lower)
        ? "plain"
        : undefined);
  return {
    reply: "I'll search the Borneo network for that now.",
    suggestions: [],
    status: "ready",
    searchQuery: catalog.searchQuery,
    searchQueries: catalog.searchQueries,
    thoughts: [
      profile.occasion
        ? `Occasion “${profile.occasion}” → hunting ${catalog.searchQuery}`
        : `Catalog hunt: ${catalog.searchQuery}`,
    ],
    profile: {
      ...profile,
      item: profile.item || catalog.searchQueries.slice(0, 2).join(" and "),
      items: profile.items?.length
        ? profile.items
        : catalog.searchQueries.slice(0, 4),
      ...(styleHint ? { style: styleHint } : {}),
      category: "fashion",
    },
    llm: "deterministic",
  };
}

async function runOpenAI(
  messages: ChatMessage[],
): Promise<SalespersonResult | null> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return null;

  try {
    const turns = userTurnCount(messages);
    const corpus = userCorpusText(messages);
    const itemKnown = detectItem(corpus) !== "unknown";
    const vagueVibe =
      !itemKnown &&
      (isVagueOccasionAsk(lastUser(messages)) || Boolean(detectOccasion(corpus)));
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
        temperature: 0.35,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          ...messages.map((m) => ({ role: m.role, content: m.content })),
          ...(vagueVibe && turns <= 2
            ? [
                {
                  role: "system" as const,
                  content:
                    "No garment noun yet — infer occasion/vibe from context. Prefer status clarifying with one short question (set vs piece / casual vs dressier). Do NOT default searchQuery to tee. thoughts must explain your inference. If ready, use complementary catalog nouns (shirt, pants, jeans, dress…).",
                },
              ]
            : []),
          ...(turns >= 2 && itemKnown
            ? [
                {
                  role: "system" as const,
                  content:
                    "Enough context — respond with status ready and a searchQuery now. Do not ask another clarifying question. Include thoughts.",
                },
              ]
            : turns >= 3
              ? [
                  {
                    role: "system" as const,
                    content:
                      "User has clarified enough — respond with status ready and catalog-noun searchQuery/searchQueries. Include thoughts explaining the occasion→garment mapping. Never default to tee alone.",
                  },
                ]
              : []),
        ],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed = parseJsonResult(content);
    if (!parsed) return null;
    return { ...parsed, llm: "openai" };
  } catch {
    return null;
  }
}

async function runBedrock(
  messages: ChatMessage[],
): Promise<SalespersonResult | null> {
  try {
    const { bedrockWanted } = await import("@/lib/bedrock/converse");
    if (!bedrockWanted()) return null;

    const {
      BedrockRuntimeClient,
      ConverseCommand,
    } = await import("@aws-sdk/client-bedrock-runtime");
    const { config } = await import("@/lib/config");

    const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim();
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();
    const client =
      accessKeyId && secretAccessKey
        ? new BedrockRuntimeClient({
            region: config.bedrockRegion,
            credentials: { accessKeyId, secretAccessKey },
          })
        : new BedrockRuntimeClient({ region: config.bedrockRegion });

    const turns = userTurnCount(messages);
    const corpus = userCorpusText(messages);
    const itemKnown = detectItem(corpus) !== "unknown";
    const vagueVibe =
      !itemKnown &&
      (isVagueOccasionAsk(lastUser(messages)) || Boolean(detectOccasion(corpus)));
    const forceReady =
      vagueVibe && turns <= 2
        ? "\n\nNo garment noun yet — infer occasion/vibe from context. Prefer status clarifying with one short question (set vs piece / casual vs dressier). Do NOT default searchQuery to tee. thoughts must explain your inference."
        : turns >= 2 && itemKnown
          ? "\n\nEnough context — respond with status ready and a searchQuery now. Do not ask another clarifying question. Include thoughts."
          : turns >= 3
            ? "\n\nUser has clarified enough — respond with status ready and catalog-noun searchQuery/searchQueries. Include thoughts. Never default to tee alone."
            : "";

    const response = await client.send(
      new ConverseCommand({
        modelId: config.bedrockModel,
        system: [{ text: SYSTEM + forceReady }],
        messages: messages.map((m) => ({
          role: m.role,
          content: [{ text: m.content }],
        })),
        inferenceConfig: { maxTokens: 512, temperature: 0.3 },
      }),
    );

    const text = (response.output?.message?.content || [])
      .map((b) => b.text)
      .filter(Boolean)
      .join("\n")
      .trim();
    if (!text) return null;
    const parsed = parseJsonResult(text);
    if (!parsed) return null;
    return { ...parsed, llm: "bedrock" };
  } catch {
    return null;
  }
}

export async function runSalesperson(
  messages: ChatMessage[],
): Promise<SalespersonResult> {
  // API only needs role + content (ignore products/links from UI state)
  const normalized = messages
    .filter((m) => m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.trim() }));

  const openai = await runOpenAI(normalized);
  if (openai) {
    return ensureConversationProgress(normalized, openai);
  }

  const bedrock = await runBedrock(normalized);
  if (bedrock) {
    return ensureConversationProgress(normalized, bedrock);
  }

  return ensureConversationProgress(
    normalized,
    runDeterministicSalesperson(normalized),
  );
}
