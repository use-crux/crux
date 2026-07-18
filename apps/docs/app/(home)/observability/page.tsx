import type { Metadata } from 'next'
import Link from 'next/link'
import { CodePanel, type CodeLine, CruxFooter, DevWindow, SectionHead } from '../_components'
import { TrackedLink } from '@/components/tracked-link'

export const metadata: Metadata = {
  title: 'Observability',
  description:
    'One canonical event graph. Crux instruments the whole harness: memory, retrieval, guardrails, routing, generation, evaluation. Render it in devtools or export it as OpenTelemetry.',
}

// ─────────────────────────────────────────────────────────────────────
// Hero trace rows.

const heroTraceRows = [
  { name: 'resolve', dur: 0.05, color: 'fg-muted', start: 0, label: '12ms' },
  { name: 'memory.read · recent', dur: 0.08, color: 'crux', start: 0.03, label: '24ms' },
  { name: 'memory.read · facts', dur: 0.06, color: 'crux', start: 0.04, label: '18ms' },
  { name: 'retriever · embed', dur: 0.1, color: 'crux', start: 0.08, label: '32ms' },
  { name: 'retriever · search', dur: 0.07, color: 'crux', start: 0.18, label: '21ms' },
  { name: 'guardrail · pii', dur: 0.04, color: 'amber', start: 0.25, label: '11ms' },
  { name: 'router · cascade', dur: 0.02, color: 'amber', start: 0.29, label: '6ms' },
  { name: 'generate · gpt-4o', dur: 0.6, color: 'crux', start: 0.31, label: '714ms', strong: true },
  { name: 'constrain · zod', dur: 0.03, color: 'amber', start: 0.91, label: '9ms' },
  { name: 'memory.write', dur: 0.04, color: 'crux', start: 0.94, label: '12ms' },
  { name: 'observe.emit', dur: 0.02, color: 'fg-muted', start: 0.98, label: '5ms' },
]

const recentTraces = [
  { id: 'reply', t: '00:14', dur: '1.2s', ok: true, active: true, tok: '892t' },
  { id: 'triage-swarm', t: '00:12', dur: '3.4s', ok: true, tok: '4.1k' },
  { id: 'draft-edit', t: '00:09', dur: '740ms', ok: true, tok: '1.3k' },
  { id: 'classify', t: '00:08', dur: '180ms', ok: true, tok: '210' },
  { id: 'reply', t: '00:04', dur: '2.1s', ok: false, tok: '1.6k', err: 'pii' },
  { id: 'summarize', t: '00:02', dur: '980ms', ok: true, tok: '780' },
  { id: 'reply', t: '00:00', dur: '1.4s', ok: true, tok: '910' },
]

const judges = [
  { l: 'faithfulness', v: 0.94 },
  { l: 'relevance', v: 0.88 },
  { l: 'safety', v: 1.0 },
]

// Map color shorthand → tailwind classes for span bars
function barColor(c: string) {
  if (c === 'crux') return 'bg-crux'
  if (c === 'amber') return 'bg-[#F4BF4F]'
  return 'bg-fd-muted-foreground/40'
}

// ─────────────────────────────────────────────────────────────────────
// Timeline deep-dive groups.

const timelineGroups: Array<{
  name: string
  color: string
  rows: Array<{ n: string; s: number; d: number; lbl: string; strong?: boolean }>
}> = [
  {
    name: 'BEFORE',
    color: 'crux',
    rows: [
      { n: 'memory.read · recent', s: 0.02, d: 0.08, lbl: '24ms' },
      { n: 'memory.read · facts', s: 0.04, d: 0.06, lbl: '18ms' },
      { n: 'retriever · embed', s: 0.1, d: 0.1, lbl: '32ms' },
      { n: 'retriever · search', s: 0.2, d: 0.07, lbl: '21ms' },
      { n: 'guardrail · pii', s: 0.27, d: 0.04, lbl: '11ms' },
    ],
  },
  {
    name: 'CALL',
    color: 'amber',
    rows: [{ n: 'generate · gpt-4o', s: 0.31, d: 0.6, lbl: '714ms', strong: true }],
  },
  {
    name: 'AFTER',
    color: 'crux',
    rows: [
      { n: 'constrain · zod', s: 0.91, d: 0.03, lbl: '9ms' },
      { n: 'memory.write', s: 0.94, d: 0.04, lbl: '12ms' },
      { n: 'evaluate · judge', s: 0.96, d: 0.02, lbl: '6ms' },
    ],
  },
]

// ─────────────────────────────────────────────────────────────────────
// Memory inspector data.

const memoryMessages = [
  { who: 'user', txt: 'Can you remind me about the demo?', t: '2m' },
  { who: 'assistant', txt: 'Sure — it’s scheduled Thursday at 10am.', t: '2m' },
  { who: 'user', txt: 'Move it to 11am please.', t: '1m' },
  { who: 'assistant', txt: 'Done. Demo now Thursday 11am.', t: '1m' },
]

// ─────────────────────────────────────────────────────────────────────
// OTel config code.

const otelCode: CodeLine[] = [
  { text: `import { config } from '@use-crux/core'`, type: 'import' },
  { text: `import { withTelemetry } from '@use-crux/otel'`, type: 'import' },
  { text: ``, type: 'blank' },
  { text: `export default config({`, type: 'code' },
  { text: `  plugins: [`, type: 'code' },
  { text: `    withTelemetry({`, type: 'highlight' },
  { text: `      serviceName: 'reply-api',`, type: 'code' },
  { text: `      // Lightweight exporter for Lambda /`, type: 'comment' },
  { text: `      // Convex / Workers. Omit for the`, type: 'comment' },
  { text: `      // standard Node OTel SDK path.`, type: 'comment' },
  { text: `      exporter: {`, type: 'code' },
  { text: `        url: process.env.OTEL_ENDPOINT,`, type: 'code' },
  { text: `        headers: {`, type: 'code' },
  { text: `          'X-Api-Key': process.env.OTEL_KEY,`, type: 'code' },
  { text: `        },`, type: 'code' },
  { text: `      },`, type: 'code' },
  { text: `    }),`, type: 'code' },
  { text: `  ],`, type: 'code' },
  { text: `})`, type: 'code' },
  { text: ``, type: 'blank' },
  { text: `// Every generate(), tool, memory op,`, type: 'comment' },
  { text: `// flow step, judge — now an OTel span`, type: 'comment' },
  { text: `// with gen_ai.* semantic conventions.`, type: 'comment' },
]

const otelStacks = [
  { name: 'Datadog', sub: 'OTLP/HTTP' },
  { name: 'Honeycomb', sub: 'OTLP/HTTP' },
  { name: 'Grafana Tempo', sub: 'OTLP/gRPC' },
  { name: 'New Relic', sub: 'OTLP/HTTP' },
  { name: 'Axiom', sub: 'OTLP/HTTP' },
  { name: 'Jaeger', sub: 'OTLP/gRPC' },
]

// ─────────────────────────────────────────────────────────────────────
// Plugin code.

const pluginCode: CodeLine[] = [
  { text: `import type { CruxPlugin } from '@use-crux/core'`, type: 'import' },
  { text: `import { subscribeObservability } from '@use-crux/core/observability'`, type: 'import' },
  { text: ``, type: 'blank' },
  { text: `export function slackAlerts(opts: {`, type: 'code' },
  { text: `  channel: string,`, type: 'code' },
  { text: `}): CruxPlugin {`, type: 'code' },
  { text: `  return {`, type: 'code' },
  { text: `    name: 'slack-alerts',`, type: 'code' },
  { text: `    install(hooks) {`, type: 'highlight' },
  { text: `      const unsubscribe = subscribeObservability((record) => {`, type: 'highlight' },
  { text: `        if (record.type !== 'span:end') return`, type: 'code' },
  { text: `        if (record.status === 'error') {`, type: 'code' },
  { text: `          fetch('https://hooks.slack.com/...', {`, type: 'code' },
  { text: `            method: 'POST',`, type: 'code' },
  { text: `            body: JSON.stringify({`, type: 'code' },
  { text: `              channel: opts.channel,`, type: 'code' },
  { text: `              text: \`judge failed in run \${record.runId}\`,`, type: 'code' },
  { text: `            }),`, type: 'code' },
  { text: `          }).catch(() => {}) // fire-and-forget`, type: 'code' },
  { text: `        }`, type: 'code' },
  { text: `      })`, type: 'highlight' },
  { text: `      return {`, type: 'code' },
  { text: `        dispose: unsubscribe,`, type: 'code' },
  { text: `      }`, type: 'code' },
  { text: `    },`, type: 'code' },
  { text: `  }`, type: 'code' },
  { text: `}`, type: 'code' },
]

const pluginHooks = [
  {
    k: 'subscribeObservability',
    v: 'Subscribe once to canonical run, span, event, artifact, and edge records from the graph spine.',
  },
  {
    k: 'middleware',
    v: 'Wrap every generate()/stream() call: logging, timing, retry, multi-tenant scoping.',
  },
  {
    k: 'resolveHook',
    v: 'Observe prompt .resolve() calls: system composition, dropped contexts.',
  },
  {
    k: 'evalReporter',
    v: 'Stream eval progress to Slack, a notebook, your own dashboard.',
  },
]

// ─────────────────────────────────────────────────────────────────────
// Cost rows.

const topPrompts = [
  { p: 'reply', c: '$142.10', t: '8.2M', share: 45 },
  { p: 'triage-swarm', c: '$84.40', t: '4.1M', share: 27 },
  { p: 'draft-edit', c: '$52.18', t: '3.0M', share: 17 },
  { p: 'summarize', c: '$24.94', t: '1.4M', share: 8 },
  { p: 'classify', c: '$11.00', t: '420k', share: 3 },
]

// ─────────────────────────────────────────────────────────────────────

export default function ObservabilityPage() {
  return (
    <main>
      {/* ── Hero ─────────────────────────────────────────── */}
      <section className="relative overflow-hidden px-6 pt-24 pb-16">
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
            background: 'radial-gradient(ellipse 60% 40% at 50% -10%, var(--crux-glow), transparent)',
          }}
        />
        <div className="mx-auto max-w-[80rem]">
          <div className="mx-auto mb-14 max-w-3xl text-center">
            <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-fd-border bg-fd-card/60 px-4 py-1.5 text-[13px] backdrop-blur-sm">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-crux" />
              <span className="text-fd-muted-foreground">Crux · Observability</span>
            </div>
            <h1 className="text-[clamp(2.5rem,6vw,4.5rem)] leading-[1.02] font-[750] tracking-[-0.038em]">
              One canonical
              <br />
              <span className="text-fd-muted-foreground">event graph.</span>
            </h1>
            <p className="mx-auto mt-7 max-w-xl text-[16px] leading-[1.65] text-fd-muted-foreground">
              Crux instruments the whole harness around your LLM call. Memory ops, retrieval, guardrails, routing,
              evals. One structured event stream, rendered locally in devtools and exported as OpenTelemetry in
              production.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <TrackedLink
                href="/docs/guides/observability/devtools"
                event="observability_demo_clicked"
                properties={{ location: 'hero' }}
                className="inline-flex items-center gap-2 rounded-lg bg-fd-primary px-6 py-2.5 text-sm font-semibold text-fd-primary-foreground transition-all hover:opacity-90"
              >
                Open devtools demo
              </TrackedLink>
              <TrackedLink
                href="/docs/guides/observability"
                event="docs_cta_clicked"
                properties={{ location: 'observability_hero' }}
                className="inline-flex items-center gap-2 rounded-lg border border-fd-border px-6 py-2.5 text-sm font-semibold transition-colors hover:bg-fd-accent"
              >
                Read the docs
              </TrackedLink>
            </div>
          </div>

          {/* Devtools 3-pane mock */}
          <DevWindow>
            <div className="grid min-h-[480px] grid-cols-1 lg:grid-cols-[15rem_1fr_18rem]">
              {/* Recent traces */}
              <div className="border-fd-border py-3 lg:border-r">
                <div className="px-4 pb-2.5">
                  <span className="font-mono text-[10px] tracking-[0.15em] uppercase text-fd-muted-foreground/60">
                    Recent
                  </span>
                </div>
                {recentTraces.map((tr, i) => (
                  <div
                    key={i}
                    className={`border-l-2 px-4 py-2.5 ${
                      tr.active ? 'border-crux bg-crux-soft/60' : 'border-transparent'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <code className={`font-mono text-[12px] ${tr.active ? 'font-semibold' : ''}`}>{tr.id}</code>
                      <span className="font-mono text-[10px] text-fd-muted-foreground/60">{tr.t}</span>
                    </div>
                    <div className="mt-1 flex justify-between">
                      <span className="flex items-center gap-1.5">
                        <span className={`h-1.5 w-1.5 rounded-full ${tr.ok ? 'bg-[#61C554]' : 'bg-[#ED6A5E]'}`} />
                        <span className="font-mono text-[10.5px] text-fd-muted-foreground">{tr.dur}</span>
                      </span>
                      <span className="font-mono text-[10.5px] text-fd-muted-foreground/60">{tr.tok}</span>
                    </div>
                    {tr.err && <div className="mt-1.5 font-mono text-[10px] text-[#ED6A5E]">guardrail.{tr.err} ✕</div>}
                  </div>
                ))}
              </div>

              {/* Timeline */}
              <div className="border-fd-border p-5 lg:border-r">
                <div className="mb-3 flex items-baseline gap-3">
                  <code className="font-mono text-[14px] font-semibold">prompt:reply</code>
                  <span className="font-mono text-[11px] text-fd-muted-foreground/60">generate · gpt-4o</span>
                  <div className="flex-1" />
                  <span
                    className="rounded px-2 py-0.5 font-mono text-[10px] text-[#61C554]"
                    style={{ background: 'color-mix(in oklab, #61C554 18%, transparent)' }}
                  >
                    OK
                  </span>
                </div>
                <div className="mt-4 grid gap-1">
                  {heroTraceRows.map((s, i) => (
                    <div key={i} className="grid items-center gap-3 sm:grid-cols-[11rem_1fr_3.25rem]">
                      <code
                        className={`font-mono text-[11px] ${s.strong ? 'font-semibold text-fd-foreground' : 'text-fd-muted-foreground'}`}
                      >
                        {s.name}
                      </code>
                      <div className="relative h-3.5 rounded-sm bg-fd-muted/40">
                        <div
                          className={`absolute inset-y-0 rounded-sm ${barColor(s.color)} ${s.strong ? 'opacity-100' : 'opacity-70'}`}
                          style={{ left: `${s.start * 100}%`, width: `${s.dur * 100}%` }}
                        />
                      </div>
                      <span className="text-right font-mono text-[10.5px] text-fd-muted-foreground/60">{s.label}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-5 rounded-md border border-fd-border bg-fd-muted/40 p-3">
                  <span className="font-mono text-[10px] tracking-[0.15em] uppercase text-fd-muted-foreground/60">
                    Resolved system
                  </span>
                  <p className="mt-2 font-mono text-[11px] leading-[1.55] text-fd-muted-foreground">
                    <span className="text-crux">{'<context id="brand" priority=30>'}</span> Write in a casual tone.
                    <br />
                    <span className="text-crux">{'<context id="memory" priority=20>'}</span> Recent: 4 messages.
                    <br />
                    <span className="text-crux">{'<context id="docs" priority=10>'}</span> Docs available.
                    <br />
                    <span className="text-fd-muted-foreground/70">Answer using memory and retrieved docs.</span>
                  </p>
                </div>
              </div>

              {/* Inspector */}
              <div className="p-5">
                <span className="font-mono text-[10px] tracking-[0.15em] uppercase text-fd-muted-foreground/60">
                  Inspector
                </span>
                <div className="mt-3">
                  <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-fd-muted-foreground/60">
                    Output (typed)
                  </span>
                  <div className="mt-2 rounded-md border border-fd-border bg-fd-muted/40 p-2.5">
                    <code className="block whitespace-pre font-mono text-[11px] leading-[1.6]">{`{
  answer: 'You asked
    me to remind you
    about the demo.'
}`}</code>
                  </div>
                </div>
                <div className="mt-4">
                  <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-fd-muted-foreground/60">
                    Judge
                  </span>
                  <div className="mt-2 grid gap-1.5">
                    {judges.map((m) => (
                      <div key={m.l}>
                        <div className="mb-0.5 flex justify-between">
                          <span className="font-mono text-[10.5px] text-fd-muted-foreground">{m.l}</span>
                          <span className="font-mono text-[10.5px]">{m.v.toFixed(2)}</span>
                        </div>
                        <div className="h-1 overflow-hidden rounded-sm bg-fd-muted/40">
                          <div className="h-full bg-crux" style={{ width: `${m.v * 100}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="mt-4">
                  <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-fd-muted-foreground/60">
                    OTel → Datadog
                  </span>
                  <div className="mt-1.5 font-mono text-[10.5px] text-fd-muted-foreground">
                    trace_id 4a7f…be0c
                    <br />
                    span_id c01e…
                  </div>
                </div>
              </div>
            </div>
          </DevWindow>

          {/* Exports to */}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-9 gap-y-3">
            <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-fd-muted-foreground/60">
              Exports to →
            </span>
            {['DATADOG', 'HONEYCOMB', 'GRAFANA', 'NEW RELIC', 'AXIOM', 'TEMPO'].map((p) => (
              <span key={p} className="font-mono text-[11px] tracking-[0.18em] text-fd-muted-foreground">
                {p}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── Thinking in Crux ─────────────────────────────── */}
      <section className="relative border-t border-b border-fd-border px-6 py-24">
        <div className="mx-auto max-w-5xl">
          <div className="grid gap-14 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <p className="text-xs font-medium tracking-[0.2em] uppercase text-crux">Why</p>
              <h2 className="mt-3.5 text-[clamp(2rem,4vw,2.75rem)] font-[700] tracking-[-0.025em] leading-[1.08]">
                Logs are a flashlight in a haystack.
              </h2>
            </div>
            <div>
              <p className="text-[16px] leading-[1.65] text-fd-muted-foreground">
                When an LLM feature flakes in production,{' '}
                <span className="text-fd-foreground">console.log of the request body isn&apos;t enough</span>. You need
                the resolved system text, the retrieval that ran, the guardrail that fired, the model that answered, the
                schema that did or didn&apos;t parse, end to end, in one place.
              </p>
              <div className="mt-6 border-t border-fd-border">
                {[
                  ['Every block', 'Memory, retrieval, guardrails, routing, generate, eval. All emit the same shape.'],
                  ['Zero overhead when disabled', 'Plugins read the event stream. No subscribers, no cost.'],
                  ['Same in dev and prod', 'The local devtools and your OTel exporter are reading the same graph.'],
                ].map(([k, v]) => (
                  <div
                    key={k}
                    className="grid items-baseline gap-4 border-b border-fd-border py-3.5 sm:grid-cols-[10rem_1fr]"
                  >
                    <code className="font-mono text-[12px] font-semibold text-crux">{k}</code>
                    <span className="text-[14px] leading-[1.55] text-fd-muted-foreground">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Timeline deep-dive ───────────────────────────── */}
      <section className="relative border-b border-fd-border px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <SectionHead
            kicker="Trace timeline"
            title="Every span. Every retry."
            subtitle="Crux groups spans into before / call / after lanes so a flaky retrieval doesn’t hide behind the model latency. Click any span for resolved inputs, outputs, and parents."
          />
          <div className="overflow-hidden rounded-xl border border-fd-border bg-fd-card/40">
            <div className="flex items-center gap-4 border-b border-fd-border px-5 py-3">
              <code className="font-mono text-[13px] font-semibold">prompt:reply</code>
              <span className="font-mono text-[11px] text-fd-muted-foreground/60">
                trace_id 4a7f…be0c · 1.21s total · 892 tokens · gpt-4o
              </span>
              <div className="flex-1" />
              <span
                className="rounded px-2 py-0.5 font-mono text-[10px] text-[#61C554]"
                style={{ background: 'color-mix(in oklab, #61C554 18%, transparent)' }}
              >
                OK
              </span>
            </div>
            <div className="px-6 py-5">
              {timelineGroups.map((g) => (
                <div key={g.name} className="mb-5">
                  <div className="mb-2 flex items-center gap-2.5">
                    <span className={`h-1.5 w-1.5 rounded-full ${barColor(g.color)}`} />
                    <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-fd-muted-foreground/60">
                      {g.name}
                    </span>
                    <span className="h-px flex-1 bg-fd-border" />
                  </div>
                  <div className="grid gap-1">
                    {g.rows.map((r, i) => (
                      <div key={i} className="grid items-center gap-3.5 sm:grid-cols-[13rem_1fr_3.5rem]">
                        <code
                          className={`font-mono text-[11.5px] ${r.strong ? 'font-semibold text-fd-foreground' : 'text-fd-muted-foreground'}`}
                        >
                          {r.n}
                        </code>
                        <div className="relative h-4 rounded-sm bg-fd-muted/40">
                          <div
                            className={`absolute inset-y-0 rounded-sm ${barColor(g.color)} ${r.strong ? 'opacity-100' : 'opacity-75'}`}
                            style={{ left: `${r.s * 100}%`, width: `${r.d * 100}%` }}
                          />
                        </div>
                        <span className="text-right font-mono text-[11px] text-fd-muted-foreground/60">{r.lbl}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <div className="relative mt-2 h-5 border-t border-dashed border-fd-border">
                {[0, 250, 500, 750, 1000, 1210].map((ms, i, arr) => (
                  <span
                    key={ms}
                    className="absolute top-1.5 font-mono text-[10px] text-fd-muted-foreground/60"
                    style={{
                      left: `${(ms / 1210) * 100}%`,
                      transform: i === arr.length - 1 ? 'translateX(-100%)' : i === 0 ? 'none' : 'translateX(-50%)',
                    }}
                  >
                    {ms}ms
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Memory + Evals inspectors ────────────────────── */}
      <section className="relative border-b border-fd-border px-6 py-24">
        <div className="mx-auto max-w-7xl">
          <SectionHead
            kicker="Inspect the harness"
            title="What was read. What was written. How it scored."
            subtitle="Each block surfaces its own inspector panel. Memory shows the keys that were read and the writes that landed. Eval shows the judges that ran across the matrix."
          />
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Memory inspector */}
            <DevWindow
              title="crux dev · memory"
              tabs={['Reads', 'Writes', 'Compaction', 'Snapshot']}
              active="Reads"
              recording={false}
              status="store: pg · session 8f3a"
            >
              <div className="p-5">
                <div className="mb-3 flex items-baseline justify-between">
                  <code className="font-mono text-[12.5px] font-semibold">memory.recentMessages</code>
                  <span className="font-mono text-[10.5px] text-fd-muted-foreground/60">read · 24ms · 4 items</span>
                </div>
                <div className="grid gap-1.5">
                  {memoryMessages.map((m, i) => (
                    <div
                      key={i}
                      className="grid items-baseline gap-2.5 rounded-md bg-fd-muted/40 px-3 py-2 sm:grid-cols-[4.5rem_1fr_2.25rem]"
                    >
                      <span
                        className={`font-mono text-[10.5px] ${m.who === 'user' ? 'text-crux' : 'text-fd-muted-foreground/70'}`}
                      >
                        {m.who}
                      </span>
                      <span className="text-[12px] leading-[1.5] text-fd-muted-foreground">{m.txt}</span>
                      <span className="text-right font-mono text-[10px] text-fd-muted-foreground/60">{m.t}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-5 flex items-baseline justify-between">
                  <code className="font-mono text-[12.5px] font-semibold">memory.facts · about-user</code>
                  <span className="font-mono text-[10.5px] text-fd-muted-foreground/60">read · 18ms · 3 keys</span>
                </div>
                <div className="mt-2 rounded-md border border-fd-border bg-fd-muted/40 p-3">
                  <pre className="font-mono text-[11px] leading-[1.65] text-fd-muted-foreground">{`{
  timezone: 'Europe/Amsterdam',
  preferences: { tone: 'casual' },
  upcoming: [ { type: 'demo', day: 'Thursday' } ],
}`}</pre>
                </div>
                <div className="mt-4 flex items-center justify-between rounded-md border border-dashed border-crux/30 bg-crux-soft/40 px-3 py-2.5">
                  <span className="font-mono text-[10.5px] text-fd-muted-foreground">pending writes</span>
                  <span className="font-mono text-[10.5px] text-crux">1 fact + 2 messages</span>
                </div>
              </div>
            </DevWindow>

            {/* Eval dashboard */}
            <DevWindow
              title="crux dev · evals"
              tabs={['Evals', 'Runs', 'Baselines', 'Review']}
              active="Runs"
              recording={false}
              status="prompt:reply · last 24h"
            >
              <div className="p-5">
                <div className="mb-5 grid grid-cols-3 gap-2.5">
                  {[
                    { k: 'faithfulness', v: 0.93, d: '+0.02' },
                    { k: 'relevance', v: 0.87, d: '−0.04' },
                    { k: 'safety', v: 0.99, d: '0.00' },
                  ].map((m) => (
                    <div key={m.k} className="rounded-md border border-fd-border bg-fd-muted/40 px-3.5 py-3">
                      <p className="font-mono text-[10px] tracking-[0.15em] uppercase text-fd-muted-foreground/60">
                        {m.k}
                      </p>
                      <p className="mt-1.5 font-mono text-[22px] font-semibold">{m.v.toFixed(2)}</p>
                      <p
                        className={`mt-1 font-mono text-[10.5px] ${m.d.startsWith('−') ? 'text-[#ED6A5E]' : m.d.startsWith('+') ? 'text-[#61C554]' : 'text-fd-muted-foreground/60'}`}
                      >
                        {m.d} vs yesterday
                      </p>
                    </div>
                  ))}
                </div>
                <p className="font-mono text-[10px] tracking-[0.18em] uppercase text-fd-muted-foreground/60">
                  Rolling average · 24h
                </p>
                <svg viewBox="0 0 400 80" width="100%" height="80" className="mt-2">
                  <line
                    x1="0"
                    y1="40"
                    x2="400"
                    y2="40"
                    stroke="currentColor"
                    strokeOpacity="0.1"
                    strokeDasharray="2 4"
                  />
                  {[
                    {
                      d: 'M0 32 L40 28 L80 30 L120 24 L160 26 L200 22 L240 28 L280 24 L320 20 L360 26 L400 22',
                      color: 'var(--crux-accent)',
                    },
                    {
                      d: 'M0 48 L40 50 L80 46 L120 52 L160 48 L200 56 L240 52 L280 58 L320 54 L360 60 L400 58',
                      color: '#F4BF4F',
                    },
                    {
                      d: 'M0 16 L40 18 L80 14 L120 12 L160 16 L200 14 L240 12 L280 10 L320 14 L360 12 L400 10',
                      color: '#61C554',
                    },
                  ].map((p, i) => (
                    <path key={i} d={p.d} fill="none" stroke={p.color} strokeWidth="1.4" />
                  ))}
                </svg>
                <div className="mt-3.5">
                  <p className="font-mono text-[10px] tracking-[0.18em] uppercase text-fd-muted-foreground/60">
                    By model · today
                  </p>
                  <div className="mt-2">
                    {['gpt-4o', 'claude-sonnet', 'gemini', 'gpt-4o-mini'].map((m, i) => (
                      <div
                        key={m}
                        className="grid items-center gap-2 border-t border-fd-border py-1.5 sm:grid-cols-[7rem_repeat(3,1fr)]"
                      >
                        <code className="font-mono text-[11px]">{m}</code>
                        {[0, 1, 2].map((j) => (
                          <div key={j} className="h-1 overflow-hidden rounded-sm bg-fd-muted/40">
                            <div
                              className="h-full bg-crux/85"
                              style={{ width: `${55 + ((m.length * (j + 2 + i)) % 35)}%` }}
                            />
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                  <p className="mt-2.5 font-mono text-[10px] tracking-[0.15em] uppercase text-fd-muted-foreground/60">
                    Faithfulness · Relevance · Safety
                  </p>
                </div>
              </div>
            </DevWindow>
          </div>
        </div>
      </section>

      {/* ── Cost + CLI ───────────────────────────────────── */}
      <section className="relative border-b border-fd-border px-6 py-24">
        <div className="mx-auto max-w-7xl">
          <SectionHead
            kicker="Cost & terminal"
            title="Tokens are spans. So are dollars."
            subtitle={
              <>
                Install{' '}
                <code className="rounded border border-fd-border bg-fd-card/80 px-1 font-mono text-[0.85em]">
                  withCostTracking()
                </code>{' '}
                and model spend rolls up the same event graph as everything else: by prompt, by model, by flow, by
                session. View it in devtools, in the{' '}
                <code className="rounded border border-fd-border bg-fd-card/80 px-1 font-mono text-[0.85em]">
                  crux cost
                </code>{' '}
                CLI, or live in a terminal dashboard.
              </>
            }
          />
          <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
            {/* Cost view */}
            <DevWindow
              title="crux dev · cost"
              tabs={['By prompt', 'By model', 'By flow', 'By session', 'Budgets']}
              active="By prompt"
              recording={false}
              status="last 7 days"
            >
              <div className="p-5">
                <div className="mb-4 flex items-baseline gap-3.5">
                  <p className="font-mono text-[10px] tracking-[0.18em] uppercase text-fd-muted-foreground/60">Week</p>
                  <p className="font-mono text-[28px] font-semibold">$314.62</p>
                  <p className="font-mono text-[11px] text-[#61C554]">−18% vs last</p>
                </div>
                <svg viewBox="0 0 400 60" width="100%" height="60">
                  {Array.from({ length: 28 }).map((_, i) => {
                    const h = 12 + ((i * 7) % 36)
                    return (
                      <rect
                        key={i}
                        x={i * 14 + 2}
                        y={60 - h}
                        width="10"
                        height={h}
                        fill="var(--crux-accent)"
                        opacity={i > 18 ? 0.55 : 0.85}
                        rx="1"
                      />
                    )
                  })}
                </svg>
                <div className="mt-4">
                  <p className="font-mono text-[10px] tracking-[0.18em] uppercase text-fd-muted-foreground/60">
                    Top prompts
                  </p>
                  {topPrompts.map((r) => (
                    <div
                      key={r.p}
                      className="grid items-center gap-3 border-t border-fd-border py-2 sm:grid-cols-[7.5rem_1fr_4.5rem_4.5rem]"
                    >
                      <code className="font-mono text-[11.5px]">{r.p}</code>
                      <div className="h-1.5 overflow-hidden rounded-sm bg-fd-muted/40">
                        <div className="h-full bg-crux/85" style={{ width: `${r.share * 2}%` }} />
                      </div>
                      <span className="text-right font-mono text-[11px] text-fd-muted-foreground">{r.t}</span>
                      <span className="text-right font-mono text-[11.5px] font-medium">{r.c}</span>
                    </div>
                  ))}
                </div>
              </div>
            </DevWindow>

            {/* CLI terminal */}
            <div className="overflow-hidden rounded-2xl border border-fd-border bg-[#0d0e10] shadow-[0_20px_50px_-20px_rgba(0,0,0,0.6)]">
              <div className="flex items-center gap-2.5 border-b border-[#1a1c20] bg-[#101216] px-3.5 py-2">
                <div className="flex gap-1.5">
                  <div className="h-2.5 w-2.5 rounded-full bg-[#3a3d42]" />
                  <div className="h-2.5 w-2.5 rounded-full bg-[#3a3d42]" />
                  <div className="h-2.5 w-2.5 rounded-full bg-[#3a3d42]" />
                </div>
                <span className="font-mono text-[11px] text-[#7a8089]">~/app · crux dev --tui</span>
              </div>
              <pre className="p-4 font-mono text-[11.5px] leading-[1.65] text-[#cfd3d8]">
                <span className="text-[#7ad7c8]">{`┏━ crux dev --tui · live ━━━━━━━━━━━━━━━━━━━━━━━━┓\n┃\n`}</span>
                {`┃ `}
                <span className="text-[#9aa0a6]">traces/min</span>
                {`   `}
                <span className="text-white">142</span>
                {`     `}
                <span className="text-[#9aa0a6]">p95</span>
                {`  `}
                <span className="text-white">1.4s</span>
                {`    `}
                <span className="text-[#9aa0a6]">err</span>
                {`  `}
                <span className="text-[#ED6A5E]">0.3%</span>
                {`\n`}
                {`┃ `}
                <span className="text-[#9aa0a6]">tokens/min</span>
                {`   `}
                <span className="text-white">89.2k</span>
                {`   `}
                <span className="text-[#9aa0a6]">$/h</span>
                {`  `}
                <span className="text-white">4.18</span>
                {`\n`}
                <span className="text-[#7ad7c8]">{`┣━ recent ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫\n`}</span>
                {`┃ `}
                <span className="text-[#61C554]">●</span>
                {` reply         `}
                <span className="text-[#9aa0a6]">1.21s</span>
                {`  892t   gpt-4o\n`}
                {`┃ `}
                <span className="text-[#61C554]">●</span>
                {` triage-swarm  `}
                <span className="text-[#9aa0a6]">3.40s</span>
                {`  4.1k   gpt-4o, claude\n`}
                {`┃ `}
                <span className="text-[#61C554]">●</span>
                {` draft-edit    `}
                <span className="text-[#9aa0a6]">0.74s</span>
                {`  1.3k   gpt-4o\n`}
                {`┃ `}
                <span className="text-[#ED6A5E]">✕</span>
                {` reply         `}
                <span className="text-[#9aa0a6]">2.10s</span>
                {`  1.6k   `}
                <span className="text-[#ED6A5E]">security.injection</span>
                {`\n`}
                {`┃ `}
                <span className="text-[#61C554]">●</span>
                {` summarize     `}
                <span className="text-[#9aa0a6]">0.98s</span>
                {`  780    gpt-4o-mini\n`}
                <span className="text-[#7ad7c8]">{`┣━ judges (last 100) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫\n`}</span>
                {`┃ faithfulness `}
                <span className="text-[#7ad7c8]">████████████████░░░</span>
                {` 0.93\n`}
                {`┃ relevance    `}
                <span className="text-[#F4BF4F]">██████████████░░░░░</span>
                {` 0.87\n`}
                {`┃ safety       `}
                <span className="text-[#61C554]">███████████████████░</span>
                {` 0.99\n`}
                <span className="text-[#7ad7c8]">{`┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛\n`}</span>
                <span className="text-[#7a8089]">{`j/k navigate · / filter · enter inspect · i index · q quit`}</span>
              </pre>
            </div>
          </div>
        </div>
      </section>

      {/* ── OTel ─────────────────────────────────────────── */}
      <section className="relative border-b border-fd-border px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <SectionHead
            kicker="In production"
            title="OpenTelemetry, on day one."
            subtitle="One adapter, every stack. Crux ships an OTel exporter that turns its event graph into spans your existing observability stack already understands."
          />
          <div className="grid items-start gap-8 lg:grid-cols-2">
            <CodePanel filename="crux.config.ts" lines={otelCode} />
            <div>
              <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-fd-muted-foreground/60">Exports to</p>
              <div className="mt-3.5 grid gap-3 sm:grid-cols-2">
                {otelStacks.map((s) => (
                  <div key={s.name} className="rounded-lg border border-fd-border bg-fd-card/50 px-4 py-3.5">
                    <p className="text-[14px] font-semibold">{s.name}</p>
                    <p className="mt-1 font-mono text-[11px] tracking-[0.08em] text-fd-muted-foreground/70">{s.sub}</p>
                  </div>
                ))}
              </div>
              <div className="mt-5 rounded-lg border border-dashed border-crux/30 bg-crux-soft/40 px-4 py-3.5">
                <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-crux">Two paths</p>
                <p className="mt-2 text-[13px] leading-[1.55] text-fd-muted-foreground">
                  <strong className="text-fd-foreground">Standard OTel</strong> for long-lived Node servers. Spans flow
                  through your global{' '}
                  <code className="rounded border border-fd-border bg-fd-card/70 px-1 font-mono text-[0.9em]">
                    TracerProvider
                  </code>
                  .
                  <br />
                  <strong className="text-fd-foreground">Lightweight exporter</strong> for Lambda, Convex, Cloudflare
                  Workers. Fire-and-forget OTLP/HTTP, no SDK to bundle.
                </p>
              </div>
              <p className="mt-5 text-[13px] leading-[1.6] text-fd-muted-foreground">
                Spans follow the{' '}
                <a
                  href="https://opentelemetry.io/docs/specs/semconv/gen-ai/"
                  className="text-crux hover:underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  OpenTelemetry GenAI semantic conventions
                </a>
                {' ('}
                <code className="rounded border border-fd-border bg-fd-card/70 px-1 font-mono text-[0.9em]">
                  gen_ai.system
                </code>
                ,{' '}
                <code className="rounded border border-fd-border bg-fd-card/70 px-1 font-mono text-[0.9em]">
                  gen_ai.request.model
                </code>
                ,{' '}
                <code className="rounded border border-fd-border bg-fd-card/70 px-1 font-mono text-[0.9em]">
                  gen_ai.usage.input_tokens
                </code>
                {'), '}
                so your existing dashboards and alerting rules just work.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Plugin system ────────────────────────────────── */}
      <section className="relative border-b border-fd-border px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <SectionHead
            kicker="Plugin system"
            title="Write your own sink."
            subtitle={
              <>
                Devtools and{' '}
                <code className="rounded border border-fd-border bg-fd-card/80 px-1 font-mono text-[0.85em]">
                  @use-crux/otel
                </code>{' '}
                are themselves{' '}
                <code className="rounded border border-fd-border bg-fd-card/80 px-1 font-mono text-[0.85em]">
                  CruxPlugin
                </code>
                s. Build your own: tap any instrumentation hook, wrap every generate() with middleware, or stream judge
                scores to Slack.
              </>
            }
          />
          <div className="grid items-start gap-8 lg:grid-cols-[1.1fr_0.9fr]">
            <CodePanel filename="plugins/slack-alerts.ts" lines={pluginCode} />
            <div className="grid gap-3.5 border-t border-fd-border pt-4">
              {pluginHooks.map(({ k, v }) => (
                <div
                  key={k}
                  className="grid items-start gap-4 border-b border-fd-border pb-3.5 sm:grid-cols-[10.5rem_1fr]"
                >
                  <code className="font-mono text-[12px] font-semibold text-crux">{k}</code>
                  <span className="text-[13.5px] leading-[1.55] text-fd-muted-foreground">{v}</span>
                </div>
              ))}
              <p className="text-[12.5px] leading-[1.6] text-fd-muted-foreground/80">
                Hooks fan out: multiple plugins can subscribe to the same event. Middleware layers. The later plugin
                wraps the earlier one. Devtools and{' '}
                <code className="rounded border border-fd-border bg-fd-card/70 px-1 font-mono text-[0.9em]">
                  @use-crux/otel
                </code>{' '}
                are just two plugins reading the same stream.
              </p>
            </div>
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
            Stop debugging from logs.
          </h2>
          <p className="mt-6 text-[1.05rem] text-fd-muted-foreground">
            Trace your harness end to end. Locally, and in production.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <TrackedLink
              href="/docs/guides/observability/devtools"
              event="observability_demo_clicked"
              properties={{ location: 'cta_bottom' }}
              className="inline-flex items-center gap-2 rounded-lg bg-fd-primary px-6 py-2.5 text-sm font-semibold text-fd-primary-foreground transition-all hover:opacity-90"
            >
              Open devtools demo
            </TrackedLink>
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-lg border border-fd-border px-6 py-2.5 text-sm font-semibold transition-colors hover:bg-fd-accent"
            >
              Back to overview
            </Link>
          </div>
          <div className="mt-10 inline-flex items-center gap-3 rounded-lg border border-fd-border bg-fd-card/50 px-5 py-2.5 font-mono text-[13px]">
            <span className="select-none text-crux/50">$</span>
            <span className="text-fd-foreground/80">npm install @use-crux/core @use-crux/otel</span>
          </div>
        </div>
      </section>

      <CruxFooter />
    </main>
  )
}
