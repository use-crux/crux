import type { Metadata } from 'next'
import Link from 'next/link'
import { CodePanel, type CodeLine, CruxFooter, SectionHead, Tile } from '../_components'
import { TrackedLink } from '@/components/tracked-link'

export const metadata: Metadata = {
  title: 'Why Crux',
  description:
    'Bad LLM output is rarely a model problem. Crux is a kit of typed, modular building blocks for the harness around your LLM call. Use one. Use ten. Nothing to lock into.',
}

// ─────────────────────────────────────────────────────────────────────
// What the harness handles — 7 capabilities, framed positively.

const harnessItems = [
  {
    n: 'Steerability',
    body: "Guardrails screen inputs, constraints validate outputs and retry the model with feedback, contexts shape the system message in priority order. The model behaves. It doesn't get to freelance.",
  },
  {
    n: 'Composable context',
    body: 'Brand voice, formatting rules, schema instructions, retrieved docs. Every contribution is a context() block. Priority-ordered, token-budgeted, reused across every prompt that needs them.',
  },
  {
    n: 'Type safety end to end',
    body: 'Inputs and outputs are Zod schemas. The compiler catches missing fields, refactors are real refactors, and the typed object you get back is the object you defined.',
  },
  {
    n: 'Provider portability',
    body: 'Define the prompt once. Switch OpenAI for Anthropic for Gemini at the call site, or hand it to your agent framework. Same definition, same tests, same traces.',
  },
  {
    n: 'Tests where the prompt lives',
    body: 'Inline test cases sit on the prompt itself. LLM-as-a-judge scoring catches drift. A CLI runner sweeps your prompt across providers in CI and surfaces regressions before they ship.',
  },
  {
    n: 'Observable by default',
    body: 'Every block emits a structured span: the resolved system, the guardrail that fired, the constraint that retried, the judge that scored. Locally in devtools, in OTel in production.',
  },
  {
    n: 'Routing & cost as code',
    body: "Cascade to a cheaper model when a classifier says it's safe. Cache responses. Attribute spend per prompt, model, session, or flow. Set warn/limit budgets that throw before the bill does.",
  },
]

// ─────────────────────────────────────────────────────────────────────
// Evolution timeline.

const evolutionStages = [
  {
    tag: 'THEN',
    meta: 'v0.1',
    title: 'Typed prompts',
    body: 'Crux started as a way to stop concatenating strings. Give prompts schemas, contexts, and TypeScript types so refactoring stopped being guesswork.',
  },
  {
    tag: 'NEXT',
    meta: 'v0.4',
    title: 'Context engineering',
    body: 'It grew to cover the whole input side: composable contexts, block-based memory, retrieval, compaction. The right inputs to the model, assembled deliberately.',
  },
  {
    tag: 'NOW',
    meta: 'v1.x',
    title: 'A harness around the model',
    body: 'Today Crux is the full layer between your app and your LLM: typed prompts, tools, guardrails, constraints, routing, evaluation, observability. Every block production LLM apps already need.',
  },
]

// ─────────────────────────────────────────────────────────────────────
// Before/after diff.

const withoutCode: CodeLine[] = [
  { text: `import { generateObject } from 'ai'`, type: 'import' },
  { text: `import { openai } from '@ai-sdk/openai'`, type: 'import' },
  { text: ``, type: 'blank' },
  { text: `// Prompt logic scattered, duplicated, untyped.`, type: 'comment' },
  { text: `const systemPrompt =`, type: 'code' },
  { text: `  '## Brand\\nProfessional, concise tone.\\n\\n' +`, type: 'code' },
  { text: `  brandRules + formatRules`, type: 'code' },
  { text: ``, type: 'blank' },
  { text: `const result = await generateObject({`, type: 'code' },
  { text: `  model: openai('gpt-4o'),`, type: 'code' },
  { text: `  system: systemPrompt,`, type: 'code' },
  { text: `  prompt: userMessage,`, type: 'code' },
  { text: `  schema: z.object({`, type: 'code' },
  { text: `    edits: z.array(z.object({`, type: 'code' },
  { text: `      blockId: z.string(),`, type: 'code' },
  { text: `      text: z.string(),`, type: 'code' },
  { text: `    })),`, type: 'code' },
  { text: `  }),`, type: 'code' },
  { text: `})`, type: 'code' },
  { text: ``, type: 'blank' },
  { text: `// You get a typed object back — and that's it.`, type: 'comment' },
  { text: `// No input screening. No retry on bad output.`, type: 'comment' },
  { text: `// No trace. No way to swap providers.`, type: 'comment' },
  { text: `// The model decides what 'behaves' means.`, type: 'comment' },
]

const withCode: CodeLine[] = [
  { text: `import { context, prompt } from '@use-crux/core'`, type: 'import' },
  { text: `import { guardrail } from '@use-crux/core/safety'`, type: 'import' },
  { text: `import { constrain } from '@use-crux/core/constrain'`, type: 'import' },
  { text: `import { generate } from '@use-crux/ai'`, type: 'import' },
  { text: `import { openai } from '@ai-sdk/openai'`, type: 'import' },
  { text: ``, type: 'blank' },
  { text: `const brand = context({`, type: 'highlight' },
  { text: `  priority: 30,`, type: 'code' },
  { text: `  system: '## Brand\\nProfessional, concise tone.',`, type: 'code' },
  { text: `})`, type: 'code' },
  { text: ``, type: 'blank' },
  { text: `const injection = guardrail({`, type: 'highlight' },
  { text: `  phase: 'input',`, type: 'code' },
  { text: `  validate: detectPromptInjection,`, type: 'code' },
  { text: `})`, type: 'code' },
  { text: ``, type: 'blank' },
  { text: `const valid = constrain({`, type: 'highlight' },
  { text: `  schema: editsShape,`, type: 'code' },
  { text: `  retry: { max: 2, withFeedback: true },`, type: 'code' },
  { text: `})`, type: 'code' },
  { text: ``, type: 'blank' },
  { text: `const edit = prompt({`, type: 'code' },
  { text: `  id: 'draft-edit',`, type: 'code' },
  { text: `  use: [brand, injection, valid],`, type: 'highlight' },
  { text: `  input:  z.object({ instruction: z.string() }),`, type: 'code' },
  { text: `  output: editsShape,`, type: 'code' },
  { text: `  system: 'You are an expert content editor.',`, type: 'code' },
  { text: `})`, type: 'code' },
  { text: ``, type: 'blank' },
  { text: `const result = await generate(edit, {`, type: 'code' },
  { text: `  model: openai('gpt-4o'),`, type: 'code' },
  { text: `  input: { instruction: 'Fix the intro' },`, type: 'code' },
  { text: `})`, type: 'code' },
  { text: ``, type: 'blank' },
  { text: `// Typed. Screened. Constrained. Traced.`, type: 'comment' },
  { text: `// Swap openai('gpt-4o') for anthropic(...)`, type: 'comment' },
  { text: `// and every test still passes.`, type: 'comment' },
]

// ─────────────────────────────────────────────────────────────────────
// Principles.

const principles = [
  {
    n: 'Prompts are data, not strings',
    body: 'A prompt is a typed data structure with schemas, contexts, hooks, and settings. You can inspect, test, and compose it before any model call.',
  },
  {
    n: 'Composition over configuration',
    body: 'Small primitives compose through consistent interfaces: asContext(), asTools(), RecordStore, generate(). Build exactly what you need.',
  },
  {
    n: 'SDK-agnostic by default',
    body: "Prompts don't import a provider. The same definition runs on Vercel AI SDK, OpenAI, Google GenAI, or your agent framework.",
  },
  {
    n: 'Evaluation is not optional',
    body: 'Inline test cases, LLM-as-a-judge scoring, and a CLI runner make testing prompts as natural as testing code.',
  },
  {
    n: 'Small API surface',
    body: 'Core concepts are prompt(), context(), and generate(). Memory, compaction, scoring, and agents build on top through the same patterns.',
  },
  {
    n: 'Observable by default',
    body: 'Every generation, memory op, compaction, and eval is traceable through devtools. Zero overhead when disabled.',
  },
]

// ─────────────────────────────────────────────────────────────────────
// What Crux is not.

const notItems = [
  {
    n: 'Not a runtime',
    body: "There's no Crux server, no execution loop, no orchestration engine. Everything Crux gives you runs in your code, against your SDK, on your infra. Nothing to operationally adopt.",
  },
  {
    n: 'Not a framework',
    body: "Crux doesn't manage your routing, deployment, or app structure. It's a toolkit you use where you need it.",
  },
  {
    n: 'Not an agent framework',
    body: 'Crux provides coordination primitives (blackboards, handoffs) but delegates execution to AI SDK, OpenAI, or Google GenAI. It also integrates with agent frameworks like Convex Agent and Mastra.',
  },
  {
    n: 'Not a prompt management platform',
    body: 'No hosted dashboard, no A/B testing SaaS. Your prompts live in your codebase, versioned with git, reviewed in PRs.',
  },
]

// ─────────────────────────────────────────────────────────────────────
// Audience pills.

const audiencePlatforms = ['Next.js', 'Node.js', 'Convex', 'Vercel Edge', 'Cloudflare Workers', 'AWS Lambda']

// ─────────────────────────────────────────────────────────────────────

export default function WhyPage() {
  return (
    <main>
      {/* ── Hero ─────────────────────────────────────────── */}
      <section className="relative overflow-hidden px-6 pt-28 pb-20 sm:pt-32">
        <div
          className="pointer-events-none absolute inset-0 -z-10 opacity-[0.03] dark:opacity-[0.04]"
          style={{
            backgroundImage:
              'linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)',
            backgroundSize: '64px 64px',
          }}
        />
        <div
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background: 'radial-gradient(ellipse 70% 45% at 50% -10%, var(--crux-glow), transparent)',
          }}
        />
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-xs font-medium tracking-[0.22em] uppercase text-crux">Why Crux</p>
          <h1 className="mx-auto mt-5 max-w-2xl text-[clamp(2.5rem,6vw,4.5rem)] leading-[1.05] font-[750] tracking-[-0.038em]">
            Bad LLM output is rarely
            <br />
            <span className="text-fd-muted-foreground">a model problem.</span>
          </h1>
          <p className="mx-auto mt-7 max-w-xl text-[1.05rem] leading-[1.65] text-fd-muted-foreground">
            When LLM features fail in production, the fix usually isn&apos;t the prompt and isn&apos;t the model.
            It&apos;s a missing memory write, a stale retrieval, a guardrail that should&apos;ve blocked the input, a
            router that picked the wrong model, an eval that should&apos;ve caught it before ship. That layer is the{' '}
            <span className="text-fd-foreground">harness</span>: everything around the model call. Crux is a kit of
            typed building blocks for it. Pick what you need, drop the rest. No runtime to adopt, no framework to fight.
          </p>
        </div>
      </section>

      {/* ── What the harness handles ─────────────────────── */}
      <section className="relative border-t border-fd-border px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <SectionHead
            kicker="What the harness handles"
            title="The things a prompt alone can’t do."
            subtitle="A prompt sets the model’s instructions. A harness makes the call behave: shaping inputs, constraining outputs, observing everything in between. These are the capabilities every production LLM app ends up needing."
          />
          <div className="grid auto-rows-min grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
            {harnessItems.map((it, i) => (
              <div key={it.n} className={i === 6 ? 'lg:col-span-2' : ''}>
                <Tile name={it.n} sub={it.body} soft={i % 2 === 0} />
              </div>
            ))}
            <div className="lg:col-span-2">
              <Tile
                name="And what comes next"
                sub="The kit grows. Each new capability is its own import. Never a runtime upgrade, never a migration."
                state="empty"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ── Evolution ────────────────────────────────────── */}
      <section className="relative border-t border-fd-border px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <SectionHead
            kicker="How Crux got here"
            title="Typed prompts grew up."
            subtitle="Crux didn’t start as a harness. It started as a way to make a single prompt typeable. Then we kept noticing the same gaps in production code, and the kit grew to fill them."
          />
          <div className="relative grid gap-4 sm:grid-cols-3">
            {/* Connector line behind cards */}
            <div className="pointer-events-none absolute top-10 right-[16%] left-[16%] hidden h-px bg-crux/25 sm:block" />
            {evolutionStages.map((s) => (
              <div
                key={s.tag}
                className="relative rounded-xl border border-fd-border bg-fd-card/50 px-6 py-6"
                style={{ zIndex: 1 }}
              >
                <div
                  className="absolute -top-[3px] left-6 h-1.5 w-4 rounded-b-[5px] border-x border-b border-fd-border"
                  style={{ background: 'var(--color-fd-background)' }}
                />
                <div
                  className="absolute -bottom-[3px] right-6 h-1.5 w-4 rounded-t-[5px] border-x border-t border-fd-border"
                  style={{ background: 'var(--color-fd-background)' }}
                />
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] tracking-[0.22em] font-semibold text-crux">{s.tag}</span>
                  <span className="font-mono text-[10px] tracking-[0.14em] text-fd-muted-foreground/60">{s.meta}</span>
                </div>
                <h3 className="mt-4 text-[22px] font-semibold tracking-[-0.018em]">{s.title}</h3>
                <p className="mt-2.5 text-[14px] leading-[1.6] text-fd-muted-foreground">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Same task. Two harnesses. ─────────────────────── */}
      <section className="relative border-t border-fd-border px-6 py-24">
        <div className="mx-auto max-w-7xl">
          <SectionHead
            kicker="Same task. Two harnesses."
            title="A prompt instructs. A harness steers."
            subtitle="Same edit task, written without and with Crux. The Crux version is longer because it does more: a guardrail screens the input, a context block carries brand voice, a constraint validates the output and retries the model when it's wrong. The model behaves, and you can see exactly why."
          />
          <div className="grid gap-5 lg:grid-cols-2">
            <CodePanel
              filename="draft-edit.ts"
              headerKicker={
                <span className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-[#ED6A5E]" />
                  <span className="font-mono text-[11px] tracking-[0.1em] text-fd-muted-foreground">
                    WITHOUT CRUX · A PROMPT
                  </span>
                </span>
              }
              lines={withoutCode}
            />
            <CodePanel
              filename="draft-edit.ts"
              borderAccent
              headerKicker={
                <span className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-crux" />
                  <span className="font-mono text-[11px] tracking-[0.1em] text-crux">WITH CRUX · A HARNESS</span>
                </span>
              }
              lines={withCode}
            />
          </div>
        </div>
      </section>

      {/* ── Design principles ────────────────────────────── */}
      <section className="relative border-t border-fd-border px-6 py-24">
        <div className="mx-auto max-w-4xl">
          <SectionHead
            kicker="Design principles"
            title="How Crux thinks about context."
            subtitle="Six choices that shape every API in the kit. If you've felt the friction of treating prompts like strings, these will sound familiar."
          />
          <ul className="border-t border-fd-border">
            {principles.map((p, i) => (
              <li key={p.n} className="grid gap-7 border-b border-fd-border py-6 sm:grid-cols-[3rem_1fr]">
                <span className="font-mono text-[11px] tracking-[0.15em] text-crux">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div>
                  <h3 className="text-[19px] font-semibold tracking-[-0.015em]">{p.n}</h3>
                  <p className="mt-2 text-[14.5px] leading-[1.6] text-fd-muted-foreground">{p.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── What Crux is not ─────────────────────────────── */}
      <section className="relative border-t border-fd-border px-6 py-24">
        <div className="mx-auto max-w-4xl">
          <SectionHead
            kicker="Scope"
            title="What Crux is not."
            subtitle="Bounded on purpose. Crux does one thing: the typed, observable layer around your model call. It leaves the rest to tools designed for it."
          />
          <div className="grid gap-4 sm:grid-cols-2">
            {notItems.map((n) => (
              <div
                key={n.n}
                className="relative rounded-xl border border-dashed border-fd-border bg-fd-card/30 px-6 py-5"
              >
                <div
                  className="absolute -top-[3px] left-6 h-1.5 w-3.5 rounded-b-[5px] border-x border-b border-dashed border-fd-border"
                  style={{ background: 'var(--color-fd-background)' }}
                />
                <h3 className="text-[16px] font-semibold tracking-[-0.01em] text-fd-muted-foreground">{n.n}</h3>
                <p className="mt-2 text-[13.5px] leading-[1.6] text-fd-muted-foreground/80">{n.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Who it's for ─────────────────────────────────── */}
      <section className="relative border-t border-fd-border px-6 py-24">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-xs font-medium tracking-[0.22em] uppercase text-crux">Who it&apos;s for</p>
          <h2 className="mt-4 text-[clamp(2rem,4vw,2.75rem)] font-[700] tracking-[-0.025em] leading-[1.1]">
            TypeScript developers shipping LLM features
            <br />
            <span className="text-fd-muted-foreground">that need to actually work.</span>
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-[16px] leading-[1.65] text-fd-muted-foreground">
            In Next.js, Node.js, or Convex. If you&apos;re managing more than a handful of prompts and shipping to users
            who expect reliable output, Crux gives you the structure to manage that complexity without adopting a
            heavyweight framework.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-2">
            {audiencePlatforms.map((p) => (
              <span
                key={p}
                className="rounded-md border border-fd-border bg-fd-card/50 px-3 py-1 font-mono text-[12px] text-fd-muted-foreground"
              >
                {p}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────── */}
      <section className="relative border-t border-fd-border px-6 py-28">
        <div
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background: 'radial-gradient(ellipse 60% 50% at 50% 110%, var(--crux-glow), transparent)',
          }}
        />
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-[clamp(2.25rem,4.5vw,3.5rem)] font-[750] tracking-[-0.032em] leading-[1.04]">
            Get started in 5 minutes.
          </h2>
          <p className="mt-5 text-[16px] text-fd-muted-foreground">
            One install, one prompt. Add memory, retrieval, guardrails, and traces as you need them.
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <TrackedLink
              href="/docs/getting-started"
              event="get_started_clicked"
              properties={{ location: 'why_page' }}
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
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
            </TrackedLink>
            <TrackedLink
              href="/compare"
              event="comparison_cta_clicked"
              properties={{ location: 'why_page' }}
              className="inline-flex items-center gap-2 rounded-lg border border-fd-border px-6 py-2.5 text-sm font-semibold transition-colors hover:bg-fd-accent"
            >
              See Comparisons
            </TrackedLink>
          </div>
          <div className="mt-9 inline-flex items-center gap-3 rounded-lg border border-fd-border bg-fd-card/50 px-5 py-2.5 font-mono text-[13px]">
            <span className="select-none text-crux/50">$</span>
            <span className="text-fd-foreground/80">npm install @use-crux/core</span>
          </div>
        </div>
      </section>

      <CruxFooter />
    </main>
  )
}
