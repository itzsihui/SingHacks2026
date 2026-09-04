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

Think like a salesperson in a store:
- Read the FULL conversation and fix obvious typos (presetn→presentation, profesional→professional, gona→gonna).
- Occasion first. If they mention a date, dinner, night out, presentation, interview, etc. without naming garments, infer they may want a complementary look (top + bottoms). Ask ONE short question: full set vs a single piece — unless they already said set/outfit/look.
- Examples of the KIND of inference (do not copy wording):
  · "going on a date" → offer a date-night set, ask set vs one piece if unclear
  · presentation / interview / office → polished shirt + pants (or blouse + trousers)
  · "full outfit" / "a set" / "the look" → search complementary pieces, not one random SKU
  · clear single item ("a tee", "jeans") → search that item; do not over-ask
- Prefer status "ready" once you know what to hunt. At most ONE clarifying question when the ask is occasion-only or truly vague.
- When ready, set status "ready" and give SHORT catalog search strings (product nouns merchants would list — NOT the user's full sentence).
- For sets: searchQuery like "shirt pants", searchQueries ["shirt","pants"] (or blouse/trousers). Include jeans as a pants hunt — merchants often title bottoms "Jeans" not "Pants".
- thoughts: 2–5 short first-person reasoning lines about THIS request. Do NOT claim you already found products.

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

function corpusText(messages: ChatMessage[]) {
  return messages.map((m) => m.content).join(" ");
}

function normalizeQuestion(text: string) {
  return text
    .toLowerCase()
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
  const t = text.toLowerCase().replace(/t\s+shirt/g, "tshirt");
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
    /\b(present(?:ation)?|interview|meeting|professional|formal|office)\b/.test(t)
  ) {
    return "outfit";
  }
  if (/\b(pants?|jeans|trousers?)\b/.test(t)) return "pants";
  if (/\b(cap|hat)\b/.test(t)) return "cap";
  if (/\b(t-?shirt|tshirt|tee|shirt|blouse)\b/.test(t)) return "tee";
  return "unknown";
}

function detectOccasion(text: string): string | undefined {
  const t = text.toLowerCase();
  if (/\b(date|dinner|night\s+out|going\s+out)\b/.test(t)) return "date";
  if (/\b(present(?:ation)?|interview|meeting|office|work)\b/.test(t)) {
    return "work";
  }
  return undefined;
}

function detectStyle(text: string): string | undefined {
  const t = text.toLowerCase();
  if (/\b(professional|formal|office|present|interview|meeting)\b/.test(t)) {
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

/** True when searchQuery is still the user's chat utterance, not catalog terms. */
function looksLikeRawUtterance(q: string): boolean {
  const t = q.trim();
  if (!t) return true;
  if (t.split(/\s+/).length > 6) return true;
  return /\b(i|im|i'm|wanna|want to|have to|gonna|looking for)\b/i.test(t);
}

function catalogSearchFromProfile(
  messages: ChatMessage[],
  profile?: FashionProfile,
): { searchQuery: string; searchQueries: string[] } {
  const corpus = corpusText(messages);
  const item = detectItem(corpus);
  const style = profile?.style || detectStyle(corpus);

  if (profile?.items && profile.items.length > 0) {
    return {
      searchQuery: profile.items.join(" "),
      searchQueries: profile.items.slice(0, 3),
    };
  }

  if (item === "outfit" || style === "professional" || style === "date") {
    return {
      searchQuery: "shirt pants jeans",
      searchQueries: ["shirt", "pants", "jeans"],
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
  if (fromProfile) {
    return { searchQuery: fromProfile, searchQueries: [fromProfile] };
  }

  return { searchQuery: "fashion apparel", searchQueries: ["shirt", "pants"] };
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
  const corpus = corpusText(messages);
  const item = detectItem(corpus);
  const style = detectStyle(corpus);
  const occasion = detectOccasion(corpus);
  const lower = corpus.toLowerCase();
  const next: FashionProfile = {
    category: "fashion",
    ...profile,
  };
  if (!next.occasion && occasion) next.occasion = occasion;
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
  if (!next.style && style) next.style = style;
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
    const budget = lower.match(
      /\b(?:under|below|max|budget)?\s*([\d.]+)\s*(usdc|xsgd|usd|sgd)?\b/,
    );
    if (budget) {
      next.budget = `${budget[1]} ${(budget[2] || "USDC").toUpperCase()}`;
    }
  }
  return next;
}

/**
 * Stops clarifying loops: known item → search. Never re-ask "what apparel?".
 */
export function ensureConversationProgress(
  messages: ChatMessage[],
  result: SalespersonResult,
): SalespersonResult {
  const turns = userTurnCount(messages);
  const corpus = corpusText(messages);
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

  const forceReady = () => {
    const catalog = catalogSearchFromProfile(messages, profile);
    return {
      ...result,
      status: "ready" as const,
      searchQuery: catalog.searchQuery,
      searchQueries: result.searchQueries?.length
        ? result.searchQueries
        : catalog.searchQueries,
      thoughts: result.thoughts?.length
        ? result.thoughts
        : [
            `Reading: “${lastUser(messages).slice(0, 120)}”`,
            `Mapped to catalog hunt: ${catalog.searchQuery}`,
          ],
      profile,
      suggestions: [] as string[],
      reply: "I'll search seller catalogs on the Borneo network for that now.",
    };
  };

  if (result.status === "ready") {
    const catalog = catalogSearchFromProfile(messages, profile);
    const rawQ = result.searchQuery?.trim() || "";
    const searchQuery =
      rawQ && !looksLikeRawUtterance(rawQ) ? rawQ : catalog.searchQuery;
    const searchQueries =
      result.searchQueries?.filter((q) => q.trim() && !looksLikeRawUtterance(q))
        .length
        ? result.searchQueries!.filter(
            (q) => q.trim() && !looksLikeRawUtterance(q),
          )
        : catalog.searchQueries;
    return {
      ...result,
      profile,
      searchQuery,
      searchQueries,
      thoughts: result.thoughts?.length
        ? result.thoughts
        : [
            `Intent → catalog terms: ${searchQuery}`,
            searchQueries.length > 1
              ? `Looking across sellers for a set: ${searchQueries.join(" + ")}`
              : `Scanning merchant products for “${searchQuery}”`,
          ],
      suggestions: [],
    };
  }

  // Named garment / explicit set → search. Occasion-only clarify stays clarifying.
  if (item !== "unknown") {
    return forceReady();
  }

  // Date/dinner with no garment yet: keep a useful "set vs piece?" ask on turn 1
  const occasion = detectOccasion(corpus) || profile.occasion;
  if (
    result.status === "clarifying" &&
    turns <= 2 &&
    occasion &&
    !wantsExplicitSet(corpus) &&
    !uselessNow
  ) {
    return { ...result, profile };
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
  const item = detectItem(corpusText(messages));
  const lower = latest.toLowerCase();
  const style = detectStyle(corpusText(messages));

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
    items: item === "outfit" ? ["shirt", "pants"] : undefined,
    style,
  });

  if (/\b(graphic|plain|oversized|black|white|budget|under|0\.0|professional|formal)/i.test(lower)) {
    if (/\bgraphic\b/i.test(lower)) profile.style = "graphic";
    if (/\bplain\b/i.test(lower)) profile.style = "plain";
    if (/\boversized\b/i.test(lower)) profile.style = "oversized";
    if (/\b(professional|formal)\b/i.test(lower)) profile.style = "professional";
    if (/\bblack\b/i.test(lower)) profile.color = "black";
    if (/\bwhite\b/i.test(lower)) profile.color = "white";
    const budget = lower.match(/under\s+([\d.]+)\s*(usdc|xsgd|usd)?/i);
    if (budget) profile.budget = `${budget[1]} ${(budget[2] || "USDC").toUpperCase()}`;
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

  if (item === "outfit" && turns >= 1) {
    const catalog = catalogSearchFromProfile(messages, profile);
    const isDate =
      profile.occasion === "date" ||
      detectOccasion(corpusText(messages)) === "date" ||
      detectStyle(corpusText(messages)) === "date";
    return ensureConversationProgress(messages, {
      reply: isDate
        ? "Date night — I'll pull a top + bottoms set from seller catalogs."
        : "Got it — I'll look across seller catalogs for a complementary top + bottoms set.",
      suggestions: [],
      status: "ready",
      searchQuery: catalog.searchQuery,
      searchQueries: catalog.searchQueries,
      thoughts: [
        isDate
          ? "They're dressing for a date and asked for a set."
          : "They want a full look, not a single SKU.",
        "Hunting complementary pieces: shirt + pants/jeans across merchants.",
      ],
      profile: {
        ...profile,
        item: "shirt and pants",
        items: ["shirt", "pants", "jeans"],
        occasion: profile.occasion || (isDate ? "date" : profile.occasion),
        style: profile.style || (isDate ? "date" : profile.style),
      },
      llm: "deterministic",
    });
  }

  // Follow-up after occasion ask: "Full set" / "Date-night set"
  if (
    turns >= 2 &&
    (wantsExplicitSet(corpusText(messages)) ||
      /\bfull\s+set\b/i.test(lastUser(messages)))
  ) {
    const catalog = catalogSearchFromProfile(messages, {
      ...profile,
      items: ["shirt", "pants", "jeans"],
    });
    const isDate =
      profile.occasion === "date" ||
      detectOccasion(corpusText(messages)) === "date";
    return ensureConversationProgress(messages, {
      reply: isDate
        ? "Perfect — searching seller catalogs for a date-night top + bottoms."
        : "Perfect — searching seller catalogs for a complementary set.",
      suggestions: [],
      status: "ready",
      searchQuery: catalog.searchQuery,
      searchQueries: catalog.searchQueries,
      thoughts: [
        "They confirmed they want a full set.",
        "I'll rank shirts/tops and pants/jeans across merchants.",
      ],
      profile: {
        ...profile,
        item: "shirt and pants",
        items: ["shirt", "pants", "jeans"],
        occasion: profile.occasion || (isDate ? "date" : profile.occasion),
      },
      llm: "deterministic",
    });
  }

  // Occasion without a named garment — ask set vs single piece (salesperson move)
  const occasion =
    detectOccasion(corpusText(messages)) || profile.occasion;
  if (occasion && item === "unknown" && turns === 1) {
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
        profile: { ...profile, occasion: "date", style: profile.style || "date" },
        llm: "deterministic",
      };
    }
    return {
      reply:
        "For that, a polished top + bottoms usually works. Want a full set, or one piece?",
      suggestions: ["Full set", "Just a shirt", "Pants"],
      status: "clarifying",
      profile: { ...profile, occasion },
      llm: "deterministic",
    };
  }

  if (item === "unknown" && turns === 1) {
    return {
      reply:
        "Happy to help. Tee, cap, pants, or a full outfit for something like a date or presentation?",
      suggestions: ["A t-shirt", "A cap", "Date-night set", "Presentation outfit"],
      status: "clarifying",
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
        "I can compare tees and caps across seller catalogs. Prefer a budget under 0.02 USDC, or just show both?",
      suggestions: ["Under 0.02 USDC", "Show both", "Focus on the tee"],
      status: "clarifying",
      profile: { ...profile, item: "shirt vs cap" },
      llm: "deterministic",
    };
  }

  if (/\bpants?\b|\bjeans\b|\btrousers?\b/.test(corpusText(messages).toLowerCase()) && turns >= 2) {
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
        budget: profile.budget || "0.02 USDC",
      },
      llm: "deterministic",
    };
  }

  // Fallback: generic apparel terms across ALL seller catalogs — never pin to one demo store.
  const catalog = catalogSearchFromProfile(messages, {
    ...profile,
    item: profile.item || "tee",
  });
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
    profile: {
      ...profile,
      item: profile.item || "tee",
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
    const itemKnown = detectItem(corpusText(messages)) !== "unknown";
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          ...messages.map((m) => ({ role: m.role, content: m.content })),
          ...(turns >= 2 && itemKnown
            ? [
                {
                  role: "system" as const,
                  content:
                    "Enough context — respond with status ready and a searchQuery now. Do not ask another clarifying question.",
                },
              ]
            : turns >= 3
              ? [
                  {
                    role: "system" as const,
                    content:
                      "User has clarified enough — respond with status ready and a searchQuery now.",
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
    const itemKnown = detectItem(corpusText(messages)) !== "unknown";
    const forceReady =
      turns >= 2 && itemKnown
        ? "\n\nEnough context — respond with status ready and a searchQuery now. Do not ask another clarifying question."
        : turns >= 3
          ? "\n\nUser has clarified enough — respond with status ready and a searchQuery now."
          : "";

    const response = await client.send(
      new ConverseCommand({
        modelId: config.bedrockModel,
        system: [{ text: SYSTEM + forceReady }],
        messages: messages.map((m) => ({
          role: m.role,
          content: [{ text: m.content }],
        })),
        inferenceConfig: { maxTokens: 512, temperature: 0.2 },
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
