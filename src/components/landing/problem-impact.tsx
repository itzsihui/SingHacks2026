"use client";

import { Reveal } from "@/components/landing/reveal";

const IMPACT = [
  {
    value: "2",
    label: "Chat apps get the closed catalog path",
    detail: "ChatGPT and Claude",
  },
  {
    value: "0",
    label: "Open HTTP surface for everyone else",
    detail: "On that same path",
  },
  {
    value: "∞",
    label: "Agent types locked out",
    detail: "Procurement, local LLMs, personal agents, custom runners",
  },
] as const;

export function LandingProblemImpact() {
  return (
    <section
      aria-label="The problem"
      className="relative overflow-hidden border-t border-white/10 bg-[#060908] px-6 py-24 md:px-10 md:py-32"
    >
      <div
        className="landing-grain pointer-events-none absolute inset-0 opacity-30"
        aria-hidden
      />
      <div className="relative mx-auto max-w-[1400px]">
        <Reveal>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--landing-fog)]/40">
            The problem
          </p>
          <h2 className="mt-4 max-w-[18ch] font-[family-name:var(--font-syne)] text-[clamp(1.75rem,4vw,2.75rem)] font-semibold leading-[1.1] tracking-tight text-[var(--landing-fog)]">
            Agent commerce is happening — but catalogs are walled.
          </h2>
          <p className="mt-4 max-w-[48ch] text-base leading-relaxed text-[var(--landing-fog)]/60">
            Merchants who only list inside closed chat surfaces are invisible to
            every agent that isn&apos;t those apps.
          </p>
        </Reveal>

        <Reveal className="mt-14 border-t border-white/10 pt-12" delay={0.05}>
          <p className="font-[family-name:var(--font-syne)] text-[clamp(2.75rem,7vw,4.25rem)] font-semibold leading-none tracking-tight text-[var(--landing-jade)]">
            1 <span className="text-[var(--landing-fog)]/35">→</span> ~0.1
          </p>
          <p className="mt-5 max-w-[40ch] font-[family-name:var(--font-syne)] text-xl font-medium leading-snug text-[var(--landing-fog)] md:text-2xl">
            For every buyer agent, roughly a tenth of an open catalog
          </p>
          <p className="mt-3 max-w-[48ch] text-sm leading-relaxed text-[var(--landing-fog)]/50">
            Demand for shopping agents outruns open, HTTP-shoppable supply —
            most inventory is HTML-only or trapped in two chat apps.
          </p>
        </Reveal>

        <div className="mt-16 grid gap-10 border-t border-white/10 pt-12 sm:grid-cols-3 sm:gap-8">
          {IMPACT.map((item, i) => (
            <Reveal key={item.value} delay={0.08 * (i + 1)}>
              <p className="font-[family-name:var(--font-syne)] text-[clamp(3rem,8vw,4.5rem)] font-semibold leading-none tracking-tight text-[var(--landing-jade)]">
                {item.value}
              </p>
              <p className="mt-4 max-w-[28ch] font-[family-name:var(--font-syne)] text-lg font-medium leading-snug text-[var(--landing-fog)]">
                {item.label}
              </p>
              <p className="mt-2 text-sm text-[var(--landing-fog)]/50">
                {item.detail}
              </p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
