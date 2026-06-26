// Shared building blocks for the Crux landing pages.
// Used by /, /why, and /observability.

import Link from 'next/link'
import type { ReactNode } from 'react'

// ─────────────────────────────────────────────────────────────────────
// Snap-notch tile — the primary visual motif across all three landings.
// Used for the hero block diagram, /why "what the harness handles" grid,
// and the multi-agent row.

type TileState = 'filled' | 'empty'

export function Tile({
  name,
  sub,
  badge,
  state = 'filled',
  soft = false,
  strong = false,
}: {
  name: string
  sub?: string
  badge?: string
  state?: TileState
  soft?: boolean
  strong?: boolean
}) {
  const isEmpty = state === 'empty'
  const baseBorder = isEmpty
    ? 'border-dashed border-fd-border'
    : strong
      ? 'border-crux/60'
      : 'border-fd-border'
  const baseBg = isEmpty
    ? 'bg-transparent'
    : strong
      ? 'bg-crux-soft'
      : soft
        ? 'bg-crux-soft/40'
        : 'bg-fd-card/50'

  return (
    <div className={`group relative h-full rounded-lg border ${baseBorder} ${baseBg} px-3.5 py-3 flex flex-col gap-1 ${strong ? 'border-[1.5px]' : ''}`}>
      {/* Snap-notch — top-left */}
      <div
        className={`absolute -top-[3px] left-3.5 h-1.5 w-3.5 rounded-b-[5px] ${strong ? 'border-x-[1.5px] border-b-[1.5px] border-crux/60' : 'border-x border-b border-fd-border'} ${isEmpty ? 'border-dashed' : ''}`}
        style={{ background: 'var(--color-fd-background)' }}
      />
      {/* Snap-notch — bottom-right */}
      <div
        className={`absolute -bottom-[3px] right-3.5 h-1.5 w-3.5 rounded-t-[5px] ${strong ? 'border-x-[1.5px] border-t-[1.5px] border-crux/60' : 'border-x border-t border-fd-border'} ${isEmpty ? 'border-dashed' : ''}`}
        style={{ background: 'var(--color-fd-background)' }}
      />

      {isEmpty ? (
        <>
          <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-fd-muted-foreground/60">
            {badge ?? 'SLOT'}
          </span>
          <p className="text-[11px] text-fd-muted-foreground/70">{sub ?? 'available'}</p>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <code className={`font-mono text-[12px] font-semibold ${strong ? 'text-crux' : 'text-fd-foreground'}`}>
              {name}
            </code>
            {badge && (
              <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-fd-muted-foreground/60">
                {badge}
              </span>
            )}
          </div>
          {sub && <p className="text-[11px] leading-[1.45] text-fd-muted-foreground">{sub}</p>}
        </>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Section header — kicker + heading + subtitle. Centred or left-aligned.

export function SectionHead({
  kicker,
  title,
  subtitle,
  align = 'center',
  maxWidth = '36rem',
}: {
  kicker?: string
  title: ReactNode
  subtitle?: ReactNode
  align?: 'center' | 'left'
  maxWidth?: string
}) {
  const alignCls = align === 'center' ? 'text-center mx-auto' : 'text-left'
  return (
    <div className={`mb-14 ${alignCls}`} style={{ maxWidth: align === 'center' ? maxWidth : undefined }}>
      {kicker && (
        <p className="mb-3 text-xs font-medium tracking-[0.2em] uppercase text-crux">{kicker}</p>
      )}
      <h2 className="text-3xl font-[700] tracking-[-0.025em] sm:text-4xl">{title}</h2>
      {subtitle && (
        <p className={`mt-4 text-[0.95rem] text-fd-muted-foreground ${align === 'center' ? 'mx-auto max-w-xl' : 'max-w-2xl'}`}>
          {subtitle}
        </p>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Devtools window chrome — used in /observability hero mock + zoom-ins.

export function DevWindow({
  title = 'crux dev',
  tabs = ['Traces', 'Memory', 'Evals', 'Security', 'Catalog'],
  active = 'Traces',
  recording = true,
  status = 'localhost:4400',
  children,
}: {
  title?: string
  tabs?: string[]
  active?: string
  recording?: boolean
  status?: string
  children: ReactNode
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-fd-border bg-fd-card/40 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.5)]">
      {/* Title bar */}
      <div className="flex items-center gap-3 border-b border-fd-border bg-fd-muted/30 px-4 py-2.5">
        <div className="flex gap-1.5">
          <div className="h-2.5 w-2.5 rounded-full bg-[#ED6A5E]" />
          <div className="h-2.5 w-2.5 rounded-full bg-[#F4BF4F]" />
          <div className="h-2.5 w-2.5 rounded-full bg-[#61C554]" />
        </div>
        <span className="font-mono text-[11px] text-fd-muted-foreground">{title}</span>
        <div className="flex-1" />
        {recording && (
          <div className="inline-flex items-center gap-1.5 rounded-md border border-fd-border bg-fd-card/60 px-2 py-1 font-mono text-[10.5px] text-fd-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-[#61C554]" />
            recording
          </div>
        )}
      </div>
      {/* Tabs */}
      <div className="flex gap-0 border-b border-fd-border bg-fd-muted/30 px-2">
        {tabs.map((t) => (
          <div
            key={t}
            className={`px-3.5 py-2.5 font-mono text-[11.5px] ${
              t === active
                ? 'border-b-2 border-crux font-semibold text-fd-foreground'
                : 'border-b-2 border-transparent text-fd-muted-foreground'
            }`}
          >
            {t}
          </div>
        ))}
      </div>
      {/* Body */}
      <div>{children}</div>
      {/* Status bar */}
      <div className="flex items-center justify-between border-t border-fd-border bg-fd-muted/30 px-4 py-2">
        <span className="font-mono text-[10px] text-fd-muted-foreground">@use-crux/devtools · {status}</span>
        <span className="font-mono text-[10px] text-fd-muted-foreground">
          traces · memory · evals · security · index
        </span>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Code block — minimal panel with optional title bar.

export type CodeLine = {
  text: string
  type: 'import' | 'code' | 'highlight' | 'comment' | 'blank'
}

export function CodePanel({
  filename,
  footer,
  lines,
  borderAccent = false,
  headerKicker,
}: {
  filename?: string
  footer?: ReactNode
  lines: CodeLine[]
  borderAccent?: boolean
  headerKicker?: ReactNode
}) {
  return (
    <div
      className={`overflow-hidden rounded-xl border bg-fd-card/50 ${
        borderAccent ? 'border-crux/35' : 'border-fd-border'
      }`}
    >
      {(filename || headerKicker) && (
        <div
          className={`flex items-center gap-2.5 border-b px-4 py-2.5 ${
            borderAccent ? 'border-crux/25 bg-crux-soft/30' : 'border-fd-border'
          }`}
        >
          {headerKicker ?? (
            <div className="flex gap-1.5">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-2 w-2 rounded-full bg-fd-muted-foreground/20" />
              ))}
            </div>
          )}
          {filename && (
            <span className={`ml-auto font-mono text-[11px] ${borderAccent ? 'text-fd-muted-foreground' : 'text-fd-muted-foreground/60'}`}>
              {filename}
            </span>
          )}
        </div>
      )}
      <div className="overflow-x-auto p-4">
        <pre className="text-[12.5px] leading-[1.7]">
          {lines.map((line, i) => (
            <div
              key={i}
              className={
                line.type === 'highlight'
                  ? 'rounded-sm bg-crux-soft px-1 -mx-1 text-fd-foreground'
                  : line.type === 'import'
                    ? 'text-fd-muted-foreground/70'
                    : line.type === 'comment'
                      ? 'text-fd-muted-foreground/50 italic'
                      : line.type === 'blank'
                        ? 'h-[1.7em]'
                        : 'text-fd-foreground/85'
              }
            >
              {line.text || ' '}
            </div>
          ))}
        </pre>
      </div>
      {footer && <div className="border-t border-fd-border bg-fd-muted/30 px-4 py-2">{footer}</div>}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Site footer — 5-column. Shared across all landings.

export function CruxFooter() {
  const columns = [
    {
      heading: 'Foundations',
      links: [
        { label: 'Thinking in Crux', href: '/docs/foundations/thinking-in-crux' },
        { label: 'Mental model', href: '/docs/foundations/mental-model' },
        { label: 'Primitives', href: '/docs/foundations/primitives' },
        { label: 'Best practices', href: '/docs/foundations/best-practices' },
      ],
    },
    {
      heading: 'Capabilities',
      links: [
        { label: 'Memory', href: '/docs/guides/memory' },
        { label: 'Retrieval', href: '/docs/guides/retrieval' },
        { label: 'Guardrails', href: '/docs/guides/safety/guardrails' },
        { label: 'Routing', href: '/docs/guides/advanced/routing' },
        { label: 'Quality', href: '/docs/guides/quality' },
        { label: 'Observability', href: '/observability' },
      ],
    },
    {
      heading: 'Adapters',
      links: [
        { label: 'Vercel AI SDK', href: '/docs/reference/adapters/ai' },
        { label: 'OpenAI SDK', href: '/docs/reference/adapters/openai' },
        { label: 'Anthropic SDK', href: '/docs/reference/adapters/anthropic' },
        { label: 'Google GenAI', href: '/docs/reference/adapters/google' },
      ],
    },
    {
      heading: 'Resources',
      links: [
        { label: 'Cookbook', href: '/docs/cookbook' },
        { label: 'Compare', href: '/compare' },
        { label: 'Examples', href: '/docs/cookbook' },
        { label: 'GitHub', href: 'https://github.com/use-crux/crux' },
        { label: 'Reference', href: '/docs/reference' },
      ],
    },
  ]

  return (
    <footer className="border-t border-fd-border bg-fd-background px-6 pb-10 pt-16">
      <div className="mx-auto grid max-w-[80rem] gap-12 lg:grid-cols-[1.4fr_repeat(4,1fr)]">
        <div>
          <div className="flex items-center gap-2">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-fd-foreground">
              <path
                d="M12 2L2 7v10l10 5 10-5V7L12 2z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
              <path d="M12 22V12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M2 7l10 5 10-5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
            <span className="text-[15px] font-bold tracking-[-0.02em]">Crux</span>
          </div>
          <p className="mt-4 max-w-[20rem] text-[13px] leading-relaxed text-fd-muted-foreground">
            TypeScript building blocks for prompts, context, memory, quality, and debugging around your model calls.
            Bring your SDK; see what the model saw, why it saw it, and whether it worked.
          </p>
          <p className="mt-6 font-mono text-[11px] tracking-[0.1em] text-fd-muted-foreground/60">
            Apache-2.0 · @use-crux/core
          </p>
        </div>
        {columns.map((col) => (
          <div key={col.heading}>
            <p className="mb-4 text-xs font-medium tracking-[0.18em] uppercase text-fd-muted-foreground/60">
              {col.heading}
            </p>
            <ul className="space-y-2.5">
              {col.links.map((link) => (
                <li key={link.label}>
                  <Link
                    href={link.href}
                    className="text-[13px] text-fd-muted-foreground transition-colors hover:text-fd-foreground"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mx-auto mt-14 flex max-w-[80rem] flex-col gap-2 border-t border-fd-border pt-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="font-mono text-[10.5px] tracking-[0.12em] uppercase text-fd-muted-foreground/50">
          © Crux · Built for TypeScript developers
        </p>
        <p className="font-mono text-[10.5px] tracking-[0.12em] uppercase text-fd-muted-foreground/50">
          Made boring, on purpose.
        </p>
      </div>
    </footer>
  )
}
