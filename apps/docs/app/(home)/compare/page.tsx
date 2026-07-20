import Link from "next/link";
import type { Metadata } from "next";
import { pageMetadata } from "@/lib/metadata";

export const metadata: Metadata = pageMetadata({
  title: "Compare",
  description:
    "How Crux compares to raw SDK calls, LangChain, and other approaches to building the harness around your LLM call.",
  path: "/compare",
});

const comparisons: {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  rows: { label: string; them: string; crux: string }[];
  verdict: string;
}[] = [
  {
    id: "vercel-ai",
    title: "vs. Vercel AI SDK (alone)",
    subtitle: "Using generateText / generateObject directly",
    description:
      "Vercel AI SDK is an excellent execution layer, and Crux uses it as its primary adapter. The comparison is about what you get when you add Crux's harness on top.",
    rows: [
      {
        label: "Prompt definition",
        them: "Inline system/prompt strings per call",
        crux: "Typed, reusable prompt() with schemas",
      },
      {
        label: "Context composition",
        them: "Manual string concatenation",
        crux: "Declarative context() with priority-based merging",
      },
      {
        label: "Multi-provider",
        them: "Provider-specific model imports",
        crux: "Same prompt definition, swap adapter at call site",
      },
      {
        label: "Evals",
        them: "Not included",
        crux: "Inline tests, judge scoring, CLI eval runner",
      },
      {
        label: "Memory",
        them: "Not included",
        crux: "Working, episodic, semantic, with asContext() / asTools()",
      },
      {
        label: "Compaction",
        them: "Not included",
        crux: "Sliding window, budget tracking, key facts extraction",
      },
    ],
    verdict:
      "AI SDK handles the model call. Crux handles everything around it. Complementary, not competing.",
  },
  {
    id: "raw-sdk",
    title: "vs. Raw SDK calls",
    subtitle: "OpenAI SDK, Anthropic SDK, Google GenAI",
    description:
      "Raw SDK calls give you maximum control but zero structure. Crux sits on top, composing your context, validating schemas, and delegating execution to the SDK. You keep full SDK access.",
    rows: [
      {
        label: "Type safety",
        them: "Manual JSON.parse + casting",
        crux: "Zod schemas, fully inferred types",
      },
      {
        label: "Context reuse",
        them: "Copy-paste strings between prompts",
        crux: "Composable context() fragments with priority",
      },
      {
        label: "Provider switch",
        them: "Rewrite every call site",
        crux: "Change one adapter import",
      },
      {
        label: "Testing",
        them: "Build your own eval harness",
        crux: "evaluate() with variants, gates, and exact evidence reuse",
      },
      {
        label: "Observability",
        them: "Console.log the request body",
        crux: "Devtools trace every generation",
      },
      {
        label: "Token management",
        them: "Count tokens manually",
        crux: "Budget tracking + automatic context dropping",
      },
    ],
    verdict:
      "Keep using the SDK. Crux doesn't replace it. Add Crux when you need memory, retrieval, guardrails, routing, evals, or observability around the call.",
  },
  {
    id: "prompt-strings",
    title: "vs. Prompt strings in code",
    subtitle: "Template literals and string concatenation",
    description:
      "If your app has 1–2 simple prompts, raw strings are fine. Crux adds value when complexity grows. Here's where the line is.",
    rows: [
      {
        label: "1–2 prompts",
        them: "Simple and sufficient",
        crux: "Unnecessary overhead",
      },
      {
        label: "Shared context",
        them: "Copy-paste between files",
        crux: "Define once, compose with use: [...]",
      },
      {
        label: "Structured output",
        them: "JSON.parse + manual validation",
        crux: "Zod schema → typed result.object",
      },
      {
        label: "Multiple models",
        them: "Separate code paths per provider",
        crux: "Same prompt, different adapter",
      },
      {
        label: "Evals",
        them: "Manual testing in playground",
        crux: "Automated eval across model matrix",
      },
      {
        label: "Team collaboration",
        them: "Hard to discover, hard to review",
        crux: "Registry, tags, devtools, introspection",
      },
    ],
    verdict:
      "Start with strings. Adopt Crux when you have shared context, need structured output, or want automated evaluation.",
  },
  {
    id: "langchain",
    title: "vs. LangChain / LlamaIndex",
    subtitle: "Full orchestration frameworks",
    description:
      "LangChain and LlamaIndex replace your SDK and own execution. Crux keeps your SDK and owns the harness around it: prompts, memory, retrieval, tools, guardrails, routing, evaluation, observability.",
    rows: [
      {
        label: "Scope",
        them: "Full orchestration (chains, agents, RAG, vector stores)",
        crux: "The harness around the SDK call (prompts, memory, retrieval, tools, guardrails, routing, evals, observability)",
      },
      {
        label: "Execution",
        them: "Own runtime with own abstractions",
        crux: "Delegates to AI SDK / OpenAI / Google directly",
      },
      {
        label: "TypeScript",
        them: "Ported from Python, partial type coverage",
        crux: "TypeScript-first, full inference from Zod schemas",
      },
      {
        label: "API surface",
        them: "Large. Many concepts, many ways to do things",
        crux: "Small. ~10 core functions, consistent interfaces",
      },
      {
        label: "Integration",
        them: "Use their patterns or fight the framework",
        crux: "Compose into any existing architecture",
      },
      {
        label: "Memory",
        them: "Built-in vector store + retriever abstractions",
        crux: "Three typed primitives (working, episodic, semantic) + pluggable stores",
      },
    ],
    verdict:
      "LangChain replaces your SDK. Crux keeps it. Pick LangChain if you want an all-in-one framework; pick Crux if you want typed building blocks around the SDK you already use.",
  },
];

export default function ComparePage() {
  return (
    <main>
      {/* ── Hero ─────────────────────────────────────────── */}
      <section className="relative overflow-hidden px-6 pt-28 pb-16 sm:pt-36 sm:pb-20">
        <div
          className="pointer-events-none absolute inset-0 -z-10 opacity-[0.03] dark:opacity-[0.04]"
          style={{
            backgroundImage:
              "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
            backgroundSize: "64px 64px",
          }}
        />

        <div className="mx-auto max-w-3xl text-center">
          <p className="mb-4 text-xs font-medium tracking-[0.2em] uppercase text-crux">
            Comparisons
          </p>
          <h1 className="text-[clamp(2rem,5vw,3.5rem)] leading-[1.1] font-[750] tracking-[-0.035em]">
            How Crux compares
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-[1.05rem] leading-relaxed text-fd-muted-foreground">
            Crux isn&apos;t trying to replace your SDK. It&apos;s a kit of typed
            building blocks for the harness around it. Pick the ones you need,
            drop the rest.
          </p>
        </div>
      </section>

      {/* ── Comparison sections ──────────────────────────── */}
      {comparisons.map((c, idx) => (
        <section
          key={c.id}
          id={c.id}
          className={`relative border-t border-fd-border px-6 py-20 ${idx % 2 === 1 ? "bg-fd-card/30" : ""}`}
        >
          <div className="mx-auto max-w-4xl">
            {/* Header */}
            <div className="mb-10">
              <p className="mb-2 text-xs font-medium tracking-[0.15em] uppercase text-crux">
                {c.subtitle}
              </p>
              <h2 className="text-2xl font-[700] tracking-[-0.02em] sm:text-3xl">
                {c.title}
              </h2>
              <p className="mt-3 max-w-2xl text-[0.95rem] text-fd-muted-foreground">
                {c.description}
              </p>
            </div>

            {/* Table */}
            <div className="overflow-hidden rounded-xl border border-fd-border">
              {/* Table header */}
              <div className="grid grid-cols-[1fr_1fr_1fr] border-b border-fd-border bg-fd-card/50">
                <div className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-fd-muted-foreground/60">
                  &nbsp;
                </div>
                <div className="border-l border-fd-border px-4 py-3 text-xs font-medium uppercase tracking-wider text-fd-muted-foreground/60">
                  Alternative
                </div>
                <div className="border-l border-fd-border px-4 py-3 text-xs font-medium uppercase tracking-wider text-crux/70">
                  Crux
                </div>
              </div>

              {/* Rows */}
              {c.rows.map((row, i) => (
                <div
                  key={row.label}
                  className={`grid grid-cols-[1fr_1fr_1fr] ${i < c.rows.length - 1 ? "border-b border-fd-border" : ""}`}
                >
                  <div className="px-4 py-3.5 text-[13px] font-semibold">
                    {row.label}
                  </div>
                  <div className="border-l border-fd-border px-4 py-3.5 text-[13px] text-fd-muted-foreground">
                    {row.them}
                  </div>
                  <div className="border-l border-fd-border px-4 py-3.5 text-[13px] text-fd-foreground/90">
                    {row.crux}
                  </div>
                </div>
              ))}
            </div>

            {/* Verdict */}
            <div className="mt-6 flex gap-3 rounded-lg border border-crux/15 bg-crux-soft px-5 py-4">
              <div className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-crux/50" />
              <p className="text-[13px] leading-relaxed text-fd-muted-foreground">
                <span className="font-medium text-fd-foreground">
                  Bottom line:
                </span>{" "}
                {c.verdict}
              </p>
            </div>
          </div>
        </section>
      ))}

      {/* ── Quick links ──────────────────────────────────── */}
      <section className="relative border-t border-fd-border px-6 py-16">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-2 text-center">
          <p className="text-[13px] text-fd-muted-foreground">
            Jump to a comparison:
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {comparisons.map((c) => (
              <a
                key={c.id}
                href={`#${c.id}`}
                className="rounded-lg border border-fd-border px-3 py-1.5 text-[13px] font-medium transition-colors hover:bg-fd-accent"
              >
                {c.title}
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────── */}
      <section className="relative border-t border-fd-border px-6 py-28">
        <div
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              "radial-gradient(ellipse 60% 50% at 50% 110%, var(--crux-glow), transparent)",
          }}
        />
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-[700] tracking-[-0.025em]">
            Try it yourself
          </h2>
          <p className="mt-4 text-[0.95rem] text-fd-muted-foreground">
            Install Crux and write your first typed prompt in under 5 minutes.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link
              href="/docs/getting-started"
              className="group inline-flex items-center gap-2 rounded-lg bg-fd-primary px-6 py-2.5 text-sm font-semibold text-fd-primary-foreground transition-all hover:opacity-90"
            >
              Get Started
              <svg
                className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
                />
              </svg>
            </Link>
            <Link
              href="/why"
              className="inline-flex items-center gap-2 rounded-lg border border-fd-border px-6 py-2.5 text-sm font-semibold transition-colors hover:bg-fd-accent"
            >
              Why Crux
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
