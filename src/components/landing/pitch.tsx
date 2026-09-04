"use client";

import { useRouter } from "next/navigation";
import { ArrowDownIcon, ArrowRightIcon } from "@phosphor-icons/react";
import { PlaceholdersAndVanishInput } from "@/components/ui/placeholders-and-vanish-input";
import { TextGenerateEffect } from "@/components/ui/text-generate-effect";
import { Reveal } from "@/components/landing/reveal";

const BUYER_PLACEHOLDERS = [
  "Going on a date — find me a set",
  "I want a black linen shirt in M",
  "Need jeans 30x32 and a top to match",
  "Find me something for dinner, not the gym",
  "Pay with Visa — show me caps under my spend limit",
];

const BUYER_MAP = [
  {
    problem: "Five screens and a redirect to buy a shirt",
    solution: "Ask once. The fashion agent ranks live SKUs.",
  },
  {
    problem: "Tabs for search, cart, checkout, then pay",
    solution: "Discover, decide, and settle with Visa in the same chat.",
  },
  {
    problem: "A poisoned product title that tries to retarget pay",
    solution:
      "Catalog text is data only. Payee, amount, and authorize stay locked.",
  },
];

const SELLER_MAP = [
  {
    problem: "Admin forms to list fifty SKUs",
    solution: "Talk the catalog, drop a CSV, or paste a store URL.",
  },
  {
    problem: "Agents cannot read an HTML shop",
    solution: "The store publishes as text agents already shop.",
  },
  {
    problem: "No trusted pay inside the conversation",
    solution: "Bind Visa receive first, then crypto. Same chat, both rails.",
  },
];

const SELLER_WORDS =
  "Type what you sell. The store is live for people and for other agents.";

function Mapping({
  rows,
}: {
  rows: { problem: string; solution: string }[];
}) {
  return (
    <ul className="mt-8 space-y-6">
      {rows.map((row) => (
        <li
          key={row.problem}
          className="grid items-center gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:gap-5"
        >
          <p className="text-sm leading-relaxed text-[var(--landing-fog)]/55 md:text-right">
            {row.problem}
          </p>
          <ArrowRightIcon
            className="hidden size-5 text-[var(--landing-jade)] md:block"
            weight="bold"
            aria-hidden
          />
          <ArrowDownIcon
            className="size-5 text-[var(--landing-jade)] md:hidden"
            weight="bold"
            aria-hidden
          />
          <p className="text-sm leading-relaxed text-[var(--landing-fog)]">
            {row.solution}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function LandingPitch() {
  const router = useRouter();

  return (
    <div className="relative mx-auto max-w-[1100px] space-y-24 md:space-y-32">
      <Reveal>
        <h2 className="font-[family-name:var(--font-syne)] text-[clamp(1.75rem,4vw,2.75rem)] font-semibold tracking-tight text-[var(--landing-fog)]">
          For buyers
        </h2>
        <p className="mt-3 max-w-[42ch] text-base leading-relaxed text-[var(--landing-fog)]/55">
          Tell the agent what you want on. It shops the live catalog — Visa
          checkout stays in chat.
        </p>
        <div className="mt-8">
          <PlaceholdersAndVanishInput
            placeholders={BUYER_PLACEHOLDERS}
            onChange={() => {}}
            onSubmit={() => {
              window.setTimeout(() => {
                router.push("/buyer/login");
              }, 700);
            }}
          />
        </div>
        <Mapping rows={BUYER_MAP} />
      </Reveal>

      <Reveal>
        <h2 className="font-[family-name:var(--font-syne)] text-[clamp(1.75rem,4vw,2.75rem)] font-semibold tracking-tight text-[var(--landing-fog)]">
          For sellers
        </h2>
        <div className="mt-5 max-w-[34ch] text-[var(--landing-fog)]">
          <TextGenerateEffect words={SELLER_WORDS} />
        </div>
        <Mapping rows={SELLER_MAP} />
      </Reveal>

      <Reveal>
        <h2 className="font-[family-name:var(--font-syne)] text-[clamp(1.75rem,4vw,2.75rem)] font-semibold tracking-tight text-[var(--landing-fog)]">
          What you both get
        </h2>
        <p className="mt-4 max-w-[48ch] text-base leading-relaxed text-[var(--landing-fog)]/70">
          Merchants go agent-ready. Buyers shop in one conversation from browse
          to pay. Visa-scoped cards lead; USDC on Base is the second rail.
          Catalog copy cannot change payee, amount, or skip authorize.
        </p>
      </Reveal>
    </div>
  );
}
