import Link from 'next/link'
import { pickHeroVariant } from './hero-variants'
import { CodePanel, type CodeLine, CruxFooter, SectionHead, Tile } from './_components'
import { TrackedLink } from '@/components/tracked-link'

export const dynamic = 'force-dynamic'

// ─────────────────────────────────────────────────────────────────────
// Hero block diagram — snap-notch tiles arranged around the prompt bus.

const heroInputs = [
  { name: 'context()', sub: 'policy · priority · budget', soft: true },
  { name: 'memory()', sub: 'recent · facts · episodes' },
  { name: 'retriever()', sub: 'index → embed → rerank', soft: true },
  { name: 'guardrail()', sub: 'pii · injection · safety' },
]

const heroOutputs = [
  { name: 'constrain()', sub: 'zod · retry with feedback', soft: true, span: 'span-3' },
  { name: 'generate()', sub: 'your SDK · your model', strong: true, span: 'span-4' },
  { name: 'evaluate()', sub: 'suites · baselines', soft: true, span: 'span-2' },
  { name: 'observe()', sub: 'traces · devtools · OTel', span: 'span-3' },
] as const

// ─────────────────────────────────────────────────────────────────────
// Composition example.

const compositionCode: CodeLine[] = [
  { text: `import { prompt } from '@use-crux/core'`, type: 'import' },
  { text: `import { memory, recentMessages, facts } from '@use-crux/core/memory'`, type: 'import' },
  { text: `import { retriever } from '@use-crux/core/retrieval'`, type: 'import' },
  { text: `import { guardrail } from '@use-crux/core/safety'`, type: 'import' },
  { text: `import { generate } from '@use-crux/ai'`, type: 'import' },
  { text: ``, type: 'blank' },
  { text: `const chat = memory({`, type: 'code' },
  { text: `  store,`, type: 'code' },
  { text: `  blocks: [recentMessages(), facts({ id: 'about-user' })],`, type: 'code' },
  { text: `})`, type: 'code' },
  { text: ``, type: 'blank' },
  { text: `const docs = retriever({ store, query: q => q.message })`, type: 'code' },
  { text: ``, type: 'blank' },
  { text: `const pii = guardrail({`, type: 'code' },
  { text: `  name: 'pii', phase: 'input',`, type: 'code' },
  { text: `  validate: detectPII,`, type: 'code' },
  { text: `})`, type: 'code' },
  { text: ``, type: 'blank' },
  { text: `const reply = prompt({`, type: 'code' },
  { text: `  use: [chat, docs, pii],`, type: 'highlight' },
  { text: `  input:  z.object({ message: z.string() }),`, type: 'code' },
  { text: `  output: z.object({ answer:  z.string() }),`, type: 'highlight' },
  { text: `  system: 'Answer using memory and retrieved docs.',`, type: 'code' },
  { text: `})`, type: 'code' },
  { text: ``, type: 'blank' },
  { text: `const result = await generate(reply, {`, type: 'code' },
  { text: `  model: openai('gpt-4o'),`, type: 'code' },
  { text: `  input: { message: 'What did we agree on?' },`, type: 'code' },
  { text: `})`, type: 'code' },
  { text: ``, type: 'blank' },
  { text: `// result.object.answer — typed, traced, safe`, type: 'comment' },
]

// ─────────────────────────────────────────────────────────────────────
// SDK adapter list.

const adapters = [
  { pkg: '@use-crux/ai', name: 'Vercel AI SDK' },
  { pkg: '@use-crux/openai', name: 'OpenAI SDK' },
  { pkg: '@use-crux/anthropic', name: 'Anthropic SDK' },
  { pkg: '@use-crux/google', name: 'Google GenAI' },
  { pkg: '@use-crux/core/ai-agent', name: 'Agent frameworks' },
]

// ─────────────────────────────────────────────────────────────────────
// Multi-agent composition primitives.

const multiAgentTiles = [
  { name: 'parallel()', sub: 'fan out, gather' },
  { name: 'pipeline()', sub: 'sequential, typed handoffs' },
  { name: 'consensus()', sub: 'vote with quorum' },
  { name: 'swarm()', sub: 'peer-to-peer routing', strong: true },
  { name: 'blackboard()', sub: 'shared typed state' },
  { name: 'handoff()', sub: 'schema-validated transfer' },
  { name: 'delegate()', sub: 'agent as callable tool' },
]

// ─────────────────────────────────────────────────────────────────────
// Quality example.

const qualityCode: CodeLine[] = [
  { text: `export default evaluate('reply.quality', {`, type: 'code' },
  { text: `  task: reply,`, type: 'code' },
  { text: `  data: [`, type: 'code' },
  { text: `    { name: 'remembers facts', input: { message: 'What did we agree on?' } },`, type: 'code' },
  { text: `    { name: 'refuses off-topic', input: { message: 'Tell me a joke' } },`, type: 'code' },
  { text: `  ],`, type: 'code' },
  { text: `  expect: (ctx) => {`, type: 'code' },
  { text: `    ctx.expect(ctx.output.answer).toContain('demo')`, type: 'highlight' },
  { text: `  },`, type: 'code' },
  { text: `  scorers: [scorers.judge({ name: 'support_fit', rubric })],`, type: 'highlight' },
  { text: `  gates: { support_fit: { min: 0.8 } },`, type: 'code' },
  { text: `})`, type: 'code' },
]

const judges = [
  { name: 'faithfulness', desc: 'Does the answer stay grounded in the retrieved context?' },
  { name: 'relevance', desc: 'Is the model addressing what the user actually asked?' },
  { name: 'safety', desc: 'Pre-built checks for refusal, leakage, off-topic drift.' },
]

// ─────────────────────────────────────────────────────────────────────
// Trade rows.

const tradeRows = [
  { l: 'Inline prompt strings', r: 'A typed prompt() with schemas' },
  { l: 'Manual string concatenation', r: 'Reusable context blocks with priority and budget' },
  { l: 'Provider-specific call sites', r: 'Bring your SDK, keep the structure' },
  { l: 'console.log of request bodies', r: 'A clear view of what the model saw' },
  { l: 'Output-only evals', r: 'Tests for the setup around the answer' },
  { l: 'A mandatory framework', r: 'Small primitives, composed by you' },
]

// ─────────────────────────────────────────────────────────────────────
// Page.

export default function HomePage() {
  const heroHeadline = pickHeroVariant()

  return (
    <main>
      {/* ── Hero ─────────────────────────────────────────── */}
      <section className="relative overflow-hidden px-6 pt-28 pb-24 sm:pt-36 sm:pb-32">
        {/* Grid background */}
        <div
          className="pointer-events-none absolute inset-0 -z-10 opacity-[0.03] dark:opacity-[0.04]"
          style={{
            backgroundImage:
              'linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)',
            backgroundSize: '64px 64px',
          }}
        />
        {/* Teal-tinted radial glow */}
        <div
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background: 'radial-gradient(ellipse 80% 50% at 50% -20%, var(--crux-glow), transparent)',
          }}
        />

        <div className="mx-auto max-w-[72rem]">
          <div className="flex flex-col items-center text-center">
            {/* Badge */}
            <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-fd-border bg-fd-card/60 px-4 py-1.5 text-[13px] backdrop-blur-sm">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-crux" />
              <span className="text-fd-muted-foreground">Harness engineering toolkit</span>
            </div>

            {/* Headline (rotates per request — see hero-variants.ts) */}
            <h1 className="max-w-3xl text-[clamp(2.5rem,6vw,4.5rem)] leading-[1.08] font-[750] tracking-[-0.035em]">
              {heroHeadline}
            </h1>

            {/* Subhead */}
            <p className="mt-6 max-w-2xl text-[1.05rem] leading-relaxed text-fd-muted-foreground sm:text-lg">
              AI failures usually hide in what gets sent to the model: stale context, missing memory, unsafe inputs,
              silent fallbacks, weak tests. Crux gives you typed building blocks for those pieces around the{' '}
              <span className="text-fd-foreground">SDK you already use</span>, so you can see what the model saw and fix
              the right layer.
            </p>

            {/* CTAs */}
            <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row">
              <TrackedLink
                href="/docs/getting-started"
                event="get_started_clicked"
                properties={{ location: 'hero' }}
                className="group relative inline-flex items-center gap-2 rounded-lg bg-fd-primary px-6 py-2.5 text-sm font-semibold text-fd-primary-foreground transition-all hover:opacity-90"
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
                href="/docs"
                event="docs_cta_clicked"
                properties={{ location: 'hero' }}
                className="inline-flex items-center gap-2 rounded-lg border border-fd-border px-6 py-2.5 text-sm font-semibold transition-colors hover:bg-fd-accent"
              >
                Read the Docs
              </TrackedLink>
            </div>

            {/* Install */}
            <div className="mt-10 inline-flex items-center gap-3 rounded-lg border border-fd-border bg-fd-card/50 px-5 py-2.5 font-mono text-[13px] backdrop-blur-sm">
              <span className="select-none text-crux/50">$</span>
              <span className="text-fd-foreground/80">npm install @use-crux/core</span>
            </div>
          </div>

          {/* Hero block diagram — snap-notch tiles around the prompt bus */}
          <div className="mx-auto mt-24 max-w-5xl">
            {/* Input tiles row */}
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {heroInputs.map((t) => (
                <Tile key={t.name} name={t.name} sub={t.sub} soft={t.soft} />
              ))}
            </div>

            {/* The bus */}
            <div className="relative my-2.5 rounded-lg border-[1.5px] border-crux/60 bg-crux-soft px-6 py-4">
              {/* snap-notches */}
              <div
                className="absolute -top-[3px] left-6 h-1.5 w-4 rounded-b-[5px] border-x-[1.5px] border-b-[1.5px] border-crux/60"
                style={{ background: 'var(--color-fd-background)' }}
              />
              <div
                className="absolute -bottom-[3px] right-6 h-1.5 w-4 rounded-t-[5px] border-x-[1.5px] border-t-[1.5px] border-crux/60"
                style={{ background: 'var(--color-fd-background)' }}
              />
              <div className="flex items-center justify-between gap-4">
                <div>
                  <code className="font-mono text-[14px] font-semibold text-crux">{'prompt({ use: [ ... ] })'}</code>
                  <p className="mt-1 text-[12.5px] text-fd-muted-foreground">
                    One place for everything the model is allowed to see.
                  </p>
                </div>
                <div className="hidden gap-1.5 sm:flex">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div
                      key={i}
                      className={`h-2 w-2 rounded-full ${i < 5 ? 'bg-crux' : 'bg-fd-muted-foreground/25'}`}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* Output tiles row */}
            <div className="grid grid-cols-12 gap-2.5">
              <div className="col-span-12 sm:col-span-3">
                <Tile name="constrain()" sub="zod · retry with feedback" soft />
              </div>
              <div className="col-span-12 sm:col-span-4">
                <Tile name="generate()" sub="your SDK · your model" strong />
              </div>
              <div className="col-span-12 sm:col-span-2">
                <Tile name="evaluate()" sub="suites · baselines" soft />
              </div>
              <div className="col-span-12 sm:col-span-3">
                <Tile name="observe()" sub="traces · devtools · OTel" />
              </div>
            </div>

            {/* Footer caption */}
            <div className="mt-5 flex justify-between px-1 font-mono text-[9.5px] tracking-[0.2em] uppercase text-fd-muted-foreground/60">
              <span>Add one piece</span>
              <span>See the whole call</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Why Crux teaser ──────────────────────────────── */}
      <section className="relative border-t border-fd-border bg-fd-muted/20 px-6 py-20">
        <div className="mx-auto grid max-w-6xl items-center gap-14 lg:grid-cols-[0.95fr_1.05fr]">
          <div>
            <p className="text-xs font-medium tracking-[0.22em] uppercase text-crux">Why Crux</p>
            <h2 className="mt-3 text-3xl font-[700] tracking-[-0.025em] sm:text-[2.5rem] sm:leading-[1.1]">
              Bad LLM output is rarely a model problem.
            </h2>
            <p className="mt-5 max-w-md text-[0.95rem] leading-relaxed text-fd-muted-foreground">
              The fix usually isn&apos;t the prompt and isn&apos;t the model. It&apos;s the missing memory, stale
              retrieval, dropped instruction, or test that should have caught the regression. Crux makes those parts
              explicit.
            </p>
            <Link
              href="/why"
              className="mt-6 inline-flex items-center gap-2 rounded-lg border border-crux/30 bg-crux-soft/50 px-3.5 py-2 text-[13px] font-medium transition-colors hover:bg-crux-soft"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-crux" />
              The full case for Crux
              <span className="text-crux">→</span>
            </Link>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {[
              { k: 'Steerability', v: 'Guardrails, constraints, and fallbacks are declared before the call.' },
              {
                k: 'Composable context',
                v: 'Brand voice, memory, and retrieval stay reusable instead of pasted together.',
              },
              { k: 'Type safety', v: 'Zod schemas in. Typed objects out. Refactors stay real.' },
              { k: 'Observable by default', v: 'See what the model saw before you start guessing.' },
            ].map((p) => (
              <div key={p.k} className="rounded-xl border border-fd-border bg-fd-card/50 px-5 py-4">
                <h3 className="text-sm font-semibold tracking-[-0.005em]">{p.k}</h3>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-fd-muted-foreground">{p.v}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Modularity ───────────────────────────────────── */}
      <section className="relative border-t border-fd-border px-6 py-24">
        <div className="mx-auto max-w-5xl">
          <SectionHead
            kicker="Modular by default"
            title="Opt in, never locked in."
            subtitle="Start with one typed building block, then add more only when your AI feature needs them. Prompts, context, memory, retrieval, guardrails, routing, tests, and traces stay modular, but they work together so you can see what the model saw and why."
          />
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              {
                k: 'START SMALL',
                title: 'Use one block first.',
                body: 'Replace a prompt string, add memory, or wrap retrieval. Each piece is its own import, and the rest stays out of your bundle.',
              },
              {
                k: 'ADD WHAT HURTS',
                title: 'Bring in the next fix when you need it.',
                body: 'Add safety, routing, tests, or traces when that part becomes the problem. You do not have to migrate into a framework first.',
              },
              {
                k: 'SEE THE CALL',
                title: 'Keep the model input visible.',
                body: 'As pieces accumulate, Crux keeps the call understandable instead of turning your AI stack into a mystery box.',
              },
            ].map((c) => (
              <div key={c.k} className="rounded-xl border border-fd-border bg-fd-card/50 px-5 py-6">
                <span className="font-mono text-[10px] tracking-[0.2em] text-crux">{c.k}</span>
                <h3 className="mt-3 text-[17px] font-semibold">{c.title}</h3>
                <p className="mt-2 text-[13.5px] leading-relaxed text-fd-muted-foreground">{c.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Composition ──────────────────────────────────── */}
      <section className="relative border-t border-fd-border px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="grid items-start gap-16 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="lg:sticky lg:top-0 lg:-my-24 lg:py-24" style={{ zIndex: 1 }}>
              <p className="mb-3 text-xs font-medium tracking-[0.2em] uppercase text-crux">Composition</p>
              <h2 className="text-3xl font-[700] tracking-[-0.025em] sm:text-[2.5rem] sm:leading-[1.1]">
                One array. Every block plugs in.
              </h2>
              <p className="mt-5 text-[0.95rem] leading-relaxed text-fd-muted-foreground">
                Memory, retrieval, guardrails. One prompt. A Crux prompt has a single{' '}
                <code className="rounded bg-fd-card/80 px-1 font-mono text-[0.9em]">use:</code> array. Drop any
                combination of blocks into it; they add context, tools, and checks without scattering logic across the
                app. The SDK still makes the call.
              </p>
              <div className="mt-8 space-y-3.5">
                {[
                  ['Resolve', 'Blocks become the prompt the model actually sees.'],
                  ['Adapt', 'Translated to the provider or runner you point at.'],
                  ['Validate', 'Output is checked against the declared schema.'],
                  ['Observe', 'Traces show what happened when the call ran.'],
                ].map(([k, v]) => (
                  <div
                    key={k}
                    className="grid items-baseline gap-4 border-t border-fd-border pt-3 sm:grid-cols-[6rem_1fr]"
                  >
                    <code className="font-mono text-[12.5px] font-semibold text-crux">{k}</code>
                    <span className="text-[13.5px] leading-[1.55] text-fd-muted-foreground">{v}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <CodePanel filename="reply.ts" lines={compositionCode} />
            </div>
          </div>
        </div>
      </section>

      {/* ── SDK-agnostic ─────────────────────────────────── */}
      <section className="relative border-t border-fd-border px-6 py-24">
        <div className="mx-auto max-w-5xl">
          <SectionHead
            kicker="SDK-agnostic by default"
            title="Bring your SDK. Keep your stack."
            subtitle="Define your prompt once with typed schemas. The call site decides who answers: your provider SDK, your in-house client, or your agent framework. Crux composes around it instead of replacing it."
          />
          <div className="flex flex-col items-center gap-3.5">
            <div className="w-full max-w-sm rounded-xl border border-fd-border bg-fd-card/60 px-6 py-4 text-center backdrop-blur-sm">
              <p className="font-mono text-[11px] text-crux">prompt()</p>
              <p className="mt-1 text-sm font-semibold">Typed, SDK-agnostic definition</p>
            </div>
            <div className="h-7 w-px bg-crux/25" />
            <div className="rounded-md border border-dashed border-crux/30 px-3 py-1 font-mono text-[11px] text-crux">
              .resolve()
            </div>
            <div className="h-7 w-px bg-crux/25" />
            <div className="grid w-full grid-cols-2 gap-3 sm:grid-cols-5">
              {adapters.map((a) => (
                <div key={a.pkg} className="rounded-xl border border-fd-border bg-fd-card/50 p-4 text-center">
                  <p className="font-mono text-[11px] text-fd-muted-foreground/60">{a.pkg}</p>
                  <p className="mt-1.5 text-[13px] font-semibold">{a.name}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Multi-agent compressed row ───────────────────── */}
      <section className="relative border-t border-fd-border px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <SectionHead
            kicker="Composition"
            title="When one call isn’t enough."
            subtitle="The same building blocks scale up when one model call becomes a workflow: sequential steps, parallel work, voting, handoffs, and routing. Add the pattern you need without giving up your SDK."
          />
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-7">
            {multiAgentTiles.map((t) => (
              <Tile key={t.name} name={t.name} sub={t.sub} strong={t.strong} soft={!t.strong} />
            ))}
          </div>
          <div className="mt-8 text-center">
            <Link
              href="/docs/guides/agents"
              className="group inline-flex items-center gap-1.5 text-sm font-medium text-crux transition-colors hover:text-crux-hover"
            >
              All composition patterns
              <svg
                className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
            </Link>
          </div>
        </div>
      </section>

      {/* ── Observability teaser ─────────────────────────── */}
      <section className="relative border-t border-fd-border px-6 py-24">
        <div className="mx-auto max-w-4xl">
          <SectionHead
            kicker="Observability"
            title="See why the answer happened."
            subtitle="When an answer is wrong, you need more than the final text. Crux shows the prompt, context, memory, retrieval, tools, safety checks, cost, and traces behind the call, locally in devtools or in your production telemetry."
          />
          <div className="grid gap-6 sm:grid-cols-2">
            {/* Development card */}
            <Link
              href="/observability"
              className="group rounded-2xl border border-fd-border bg-fd-card/50 p-8 transition-colors hover:bg-crux-soft"
            >
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-crux/10">
                  <svg
                    className="h-4 w-4 text-crux"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                    />
                  </svg>
                </div>
                <span className="text-[11px] font-medium tracking-[0.15em] uppercase text-crux/60">Development</span>
              </div>
              <h3 className="text-lg font-semibold">Visual devtools</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-fd-muted-foreground">
                Live trace timeline, resolved system preview, memory ops, Quality rolling averages. Web UI and terminal
                dashboard for the same data.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {['crux dev', 'crux traces', 'crux quality'].map((cmd) => (
                  <span
                    key={cmd}
                    className="rounded-md bg-fd-muted/50 px-2.5 py-1 font-mono text-[11px] text-fd-muted-foreground"
                  >
                    {cmd}
                  </span>
                ))}
              </div>
            </Link>

            {/* Production card */}
            <Link
              href="/observability"
              className="group rounded-2xl border border-fd-border bg-fd-card/50 p-8 transition-colors hover:bg-crux-soft"
            >
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-crux/10">
                  <svg
                    className="h-4 w-4 text-crux"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </div>
                <span className="text-[11px] font-medium tracking-[0.15em] uppercase text-crux/60">Production</span>
              </div>
              <h3 className="text-lg font-semibold">OpenTelemetry</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-fd-muted-foreground">
                Send spans to Datadog, Honeycomb, Grafana, or any OTel-compatible platform. Works in Lambda, Convex, and
                Cloudflare Workers.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {['Datadog', 'Honeycomb', 'Grafana', 'New Relic'].map((platform) => (
                  <span
                    key={platform}
                    className="rounded-md bg-fd-muted/50 px-2.5 py-1 text-[11px] text-fd-muted-foreground"
                  >
                    {platform}
                  </span>
                ))}
              </div>
            </Link>
          </div>

          {/* Plugin system callout */}
          <div className="mt-6 rounded-xl border border-dashed border-crux/20 bg-crux-soft/30 px-6 py-4 text-center">
            <p className="text-[13px] text-fd-muted-foreground">
              Both built on the{' '}
              <Link href="/docs/guides/observability/plugins" className="font-medium text-crux hover:text-crux-hover">
                plugin system
              </Link>
              . Composable, zero-overhead when disabled, extensible with custom plugins.
            </p>
          </div>

          <div className="mt-8 text-center">
            <Link
              href="/observability"
              className="inline-flex items-center gap-2 rounded-lg border border-crux/30 bg-crux-soft/50 px-3.5 py-2 text-[13px] font-medium transition-colors hover:bg-crux-soft"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-crux" />
              See the devtools in action
              <span className="text-crux">→</span>
            </Link>
          </div>
        </div>
      </section>

      {/* ── Evals ─────────────────────────────────────────── */}
      <section className="relative border-t border-fd-border px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <SectionHead
            kicker="Evaluation"
            title="Test the setup, not just the answer."
            subtitle="Catch regressions before users do. Put expected cases next to the prompt, run them in CI, compare baselines, and test the setup around the model instead of only grading the final text."
          />
          <div className="grid items-stretch gap-8 lg:grid-cols-[1.1fr_0.9fr]">
            <CodePanel
              filename="reply.eval.ts"
              lines={qualityCode}
              footer={
                <span className="font-mono text-[11px]">
                  <span className="text-crux">$</span>
                  <span className="ml-2 text-fd-muted-foreground">crux quality run reply.quality</span>
                </span>
              }
            />
            <div className="flex flex-col gap-5 rounded-xl border border-fd-border bg-fd-card/50 p-6">
              <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-fd-muted-foreground/60">
                Built-in judges
              </p>
              <div className="grid gap-3.5">
                {judges.map((j) => (
                  <div key={j.name} className="grid items-start gap-3.5 sm:grid-cols-[7rem_1fr]">
                    <code className="font-mono text-[12.5px] font-semibold text-crux">{j.name}</code>
                    <span className="text-[13px] leading-[1.5] text-fd-muted-foreground">{j.desc}</span>
                  </div>
                ))}
              </div>
              <div className="mt-auto rounded-lg border border-fd-border bg-fd-muted/40 px-4 py-3">
                <p className="font-mono text-[10px] tracking-[0.18em] uppercase text-fd-muted-foreground/60">
                  Runs across
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {['gpt-4o', 'claude-sonnet', 'gemini', 'gpt-4o-mini', 'haiku', 'your model'].map((m) => (
                    <span
                      key={m}
                      className="rounded-md border border-fd-border bg-fd-background/60 px-2 py-0.5 font-mono text-[10.5px] text-fd-muted-foreground"
                    >
                      {m}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── The trade ────────────────────────────────────── */}
      <section className="relative border-t border-fd-border px-6 py-24">
        <div className="mx-auto max-w-4xl">
          <SectionHead
            kicker="The trade"
            title="What you put down. What you pick up."
            subtitle="Crux doesn't replace your SDK. It sits alongside, organizes the pieces around the call, validates the result, shows what happened, and gets out of the way."
          />
          <div className="border-t border-fd-border">
            {tradeRows.map((r, i) => (
              <div
                key={i}
                className="grid items-baseline gap-4 border-b border-fd-border py-5 sm:grid-cols-[1fr_2.5rem_1fr]"
              >
                <span className="text-[15px] text-fd-muted-foreground/80 sm:text-right">{r.l}</span>
                <span className="font-mono text-[14px] text-crux sm:text-center">→</span>
                <span className="text-[15px] font-medium">{r.r}</span>
              </div>
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
          <h2 className="text-[clamp(2.5rem,5vw,4rem)] font-[750] tracking-[-0.035em] leading-[1.02]">
            Start with one block.
          </h2>
          <p className="mt-6 text-[1.05rem] text-fd-muted-foreground">
            Add the rest when you need them. Bring your SDK. No runtime to adopt. Nothing to migrate away from.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <TrackedLink
              href="/docs/getting-started"
              event="get_started_clicked"
              properties={{ location: 'cta_bottom' }}
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
              href="/docs"
              event="docs_cta_clicked"
              properties={{ location: 'cta_bottom' }}
              className="inline-flex items-center gap-2 rounded-lg border border-fd-border px-6 py-2.5 text-sm font-semibold transition-colors hover:bg-fd-accent"
            >
              Read the Docs
            </TrackedLink>
          </div>
          <div className="mt-10 inline-flex items-center gap-3 rounded-lg border border-fd-border bg-fd-card/50 px-5 py-2.5 font-mono text-[13px]">
            <span className="select-none text-crux/50">$</span>
            <span className="text-fd-foreground/80">alpha · available on npm</span>
          </div>
        </div>
      </section>

      <CruxFooter />
    </main>
  )
}
