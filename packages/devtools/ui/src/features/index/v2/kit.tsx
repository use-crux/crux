/**
 * Index v2 design system — kind/family registry + atom layer.
 *
 * Ported from the design's index-kit.jsx. KIND is communicated by GLYPH +
 * LABEL; tone is a restrained family-level signal on the glyph and a
 * hairline rail. Saturated colour is reserved for status (fidelity,
 * confidence, indexing). Unknown kinds fall back to a muted record — never
 * throw.
 */

import type { ReactNode } from 'react'
import type { ProjectIndexingStatus } from '@/types'
import { T, toneColor, type Tone } from './tokens'
import { CatIcon, Icon } from './icons'

// ── families ─────────────────────────────────────────────────────────────────
export type FamilyId =
  | 'authoring'
  | 'agent'
  | 'capability'
  | 'orchestration'
  | 'routing'
  | 'state'
  | 'safety'
  | 'quality'

export interface FamilyDef {
  label: string
  tone: Tone
  blurb: string
}

export const INDEX_FAMILIES: Record<FamilyId, FamilyDef> = {
  authoring: {
    label: 'Authoring',
    tone: 'iris',
    blurb: 'What the model reads — prompts and the context assembled around them.',
  },
  agent: { label: 'Agents', tone: 'crux', blurb: 'Autonomous actors that loop over tools, prompts and handoffs.' },
  capability: {
    label: 'Capabilities',
    tone: 'ok',
    blurb: 'Tools and retrieval — what an agent calls to act on or fetch from the world.',
  },
  orchestration: {
    label: 'Orchestration',
    tone: 'blue',
    blurb: 'How work is sequenced — flows, steps and multi-agent compositions.',
  },
  routing: {
    label: 'Routing',
    tone: 'warn',
    blurb: 'Decision points — routers, cascades and fallbacks that choose a path.',
  },
  state: {
    label: 'State',
    tone: 'plum',
    blurb: 'Where agents remember and collaborate — memory, blackboards, workspaces.',
  },
  safety: { label: 'Safety', tone: 'danger', blurb: 'Constraints and guardrails that gate what the system may do.' },
  quality: {
    label: 'Quality',
    tone: 'gold',
    blurb: 'How behaviour is measured — scorers, datasets, suites and evals.',
  },
}

export const INDEX_FAMILY_ORDER: FamilyId[] = [
  'authoring',
  'agent',
  'capability',
  'orchestration',
  'routing',
  'state',
  'safety',
  'quality',
]

// ── kinds ────────────────────────────────────────────────────────────────────
interface KindDef {
  label: string
  family: FamilyId | null
  glyph: string
  child?: boolean
}

export const INDEX_KINDS: Record<string, KindDef> = {
  prompt: { label: 'Prompt', family: 'authoring', glyph: 'doc' },
  context: { label: 'Context', family: 'authoring', glyph: 'layers' },
  injectable: { label: 'Injectable', family: 'authoring', glyph: 'inject' },
  tool: { label: 'Tool', family: 'capability', glyph: 'tool' },
  agent: { label: 'Agent', family: 'agent', glyph: 'bot' },
  flow: { label: 'Flow', family: 'orchestration', glyph: 'flow' },
  'flow.step': { label: 'Step', family: 'orchestration', glyph: 'step', child: true },
  'composition.parallel': { label: 'Parallel', family: 'orchestration', glyph: 'parallel' },
  'composition.parallel.branch': { label: 'Branch', family: 'orchestration', glyph: 'branch', child: true },
  'composition.pipeline': { label: 'Pipeline', family: 'orchestration', glyph: 'pipeline' },
  'composition.pipeline.stage': { label: 'Stage', family: 'orchestration', glyph: 'stage', child: true },
  'composition.swarm': { label: 'Swarm', family: 'orchestration', glyph: 'swarm' },
  'composition.consensus': { label: 'Consensus', family: 'orchestration', glyph: 'consensus' },
  'routing.router': { label: 'Router', family: 'routing', glyph: 'router' },
  'routing.router.route': { label: 'Route', family: 'routing', glyph: 'route', child: true },
  'routing.cascade': { label: 'Cascade', family: 'routing', glyph: 'cascade' },
  'routing.cascade.tier': { label: 'Tier', family: 'routing', glyph: 'tier', child: true },
  'routing.fallback': { label: 'Fallback', family: 'routing', glyph: 'fallback' },
  'routing.fallback.option': { label: 'Option', family: 'routing', glyph: 'option', child: true },
  'rag.knowledgeBase': { label: 'Knowledge base', family: 'capability', glyph: 'db' },
  'rag.recipe': { label: 'RAG recipe', family: 'capability', glyph: 'pipeline' },
  'rag.recipe.step': { label: 'RAG step', family: 'capability', glyph: 'stage', child: true },
  'rag.pipeline': { label: 'RAG pipeline', family: 'capability', glyph: 'pipeline' },
  'rag.pipeline.stage': { label: 'RAG stage', family: 'capability', glyph: 'stage', child: true },
  'rag.reranker': { label: 'Reranker', family: 'capability', glyph: 'spark' },
  'rag.retriever': { label: 'Retriever', family: 'capability', glyph: 'search' },
  memory: { label: 'Memory', family: 'state', glyph: 'brain' },
  'memory.store': { label: 'Store', family: 'state', glyph: 'db', child: true },
  'memory.block': { label: 'Block', family: 'state', glyph: 'block', child: true },
  blackboard: { label: 'Blackboard', family: 'state', glyph: 'grid' },
  workspace: { label: 'Workspace', family: 'state', glyph: 'folder' },
  'storage.recordStore': { label: 'Record store', family: 'state', glyph: 'db', child: true },
  'storage.vectorStore': { label: 'Vector store', family: 'state', glyph: 'search', child: true },
  'storage.blobStore': { label: 'Blob store', family: 'state', glyph: 'folder', child: true },
  'storage.bundle': { label: 'Storage bundle', family: 'state', glyph: 'layers' },
  'storage.scope': { label: 'Storage scope', family: 'state', glyph: 'grid' },
  constraint: { label: 'Constraint', family: 'safety', glyph: 'lock' },
  guardrail: { label: 'Guardrail', family: 'safety', glyph: 'shield' },
  scorer: { label: 'Scorer', family: 'quality', glyph: 'gauge' },
  dataset: { label: 'Dataset', family: 'quality', glyph: 'dataset' },
  suite: { label: 'Suite', family: 'quality', glyph: 'list' },
  'suite.case': { label: 'Case', family: 'quality', glyph: 'case', child: true },
  'eval.prompt': { label: 'Prompt eval', family: 'quality', glyph: 'sparkle' },
  'eval.flow': { label: 'Flow eval', family: 'quality', glyph: 'sparkle' },
  'eval.rag': { label: 'RAG eval', family: 'quality', glyph: 'sparkle' },
  'eval.quality': { label: 'Quality eval', family: 'quality', glyph: 'sparkle' },
  unknown: { label: 'Unknown', family: null, glyph: 'doc' },
}

export interface KindMeta {
  kind: string
  label: string
  glyph: string
  family: FamilyId | null
  child: boolean
  tone: Tone
  familyLabel: string
}

export function kindMeta(kind: string): KindMeta {
  const k = INDEX_KINDS[kind] ?? INDEX_KINDS.unknown
  const fam = k.family ? INDEX_FAMILIES[k.family] : null
  return {
    kind,
    label: k.label,
    glyph: k.glyph,
    family: k.family,
    child: !!k.child,
    tone: fam ? fam.tone : 'muted',
    familyLabel: fam ? fam.label : 'Other',
  }
}

export function familyMeta(id: FamilyId | null): FamilyDef {
  if (id && INDEX_FAMILIES[id]) return INDEX_FAMILIES[id]
  return { label: 'Other', tone: 'muted', blurb: '' }
}

// ── glyph + badge ────────────────────────────────────────────────────────────
export function KindGlyph({
  kind,
  size = 24,
  iconSize,
  ring = true,
}: {
  kind: string
  size?: number
  iconSize?: number
  ring?: boolean
}) {
  const m = kindMeta(kind)
  const c = toneColor(T, m.tone)
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.28),
        background: c.soft,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        boxShadow: ring ? `inset 0 0 0 1px ${c.line}` : 'none',
      }}
    >
      <CatIcon name={m.glyph} size={iconSize ?? Math.round(size * 0.54)} color={c.fg} />
    </div>
  )
}

export function KindBadge({ kind, mono = true, label }: { kind: string; mono?: boolean; label?: string }) {
  const m = kindMeta(kind)
  const c = toneColor(T, m.tone)
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '2px 8px 2px 6px',
        borderRadius: 5,
        background: c.soft,
        color: c.fg,
        boxShadow: `inset 0 0 0 1px ${c.line}`,
        fontFamily: mono ? T.mono : T.sans,
        fontSize: 11,
        fontWeight: 500,
        whiteSpace: 'nowrap',
        lineHeight: 1.4,
      }}
    >
      <CatIcon name={m.glyph} size={11} color={c.fg} />
      {label ?? m.label}
    </span>
  )
}

export function FamilyDot({ family, size = 7 }: { family: FamilyId | null; size?: number }) {
  const c = toneColor(T, familyMeta(family).tone)
  return (
    <span
      style={{ width: size, height: size, borderRadius: 99, background: c.fg, flexShrink: 0, display: 'inline-block' }}
    />
  )
}

// ── fidelity ─────────────────────────────────────────────────────────────────
export function FidelityChip({ value, size = 'sm' }: { value: string; size?: 'xs' | 'sm' }) {
  const map: Record<string, { tone: Tone; label: string }> = {
    resolved: { tone: 'ok', label: 'resolved' },
    partial: { tone: 'warn', label: 'partial' },
    error: { tone: 'danger', label: 'error' },
  }
  const m = map[value] ?? map.partial
  const c = toneColor(T, m.tone)
  const fs = size === 'xs' ? 9.5 : 10.5
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: size === 'xs' ? '1px 5px' : '2px 6px',
        borderRadius: 4,
        background: c.soft,
        color: c.fg,
        fontFamily: T.mono,
        fontSize: fs,
        letterSpacing: '0.03em',
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ width: 4, height: 4, borderRadius: 99, background: c.fg }} />
      {m.label}
    </span>
  )
}

export function StatusDot({
  tone = 'muted',
  size = 6,
  pulse = false,
}: {
  tone?: Tone
  size?: number
  pulse?: boolean
}) {
  const c = toneColor(T, tone)
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: 99,
        background: c.fg,
        boxShadow: `0 0 0 ${pulse ? 3 : 2}px ${c.soft}`,
        flexShrink: 0,
        display: 'inline-block',
      }}
    />
  )
}

// ── confidence ladder ────────────────────────────────────────────────────────
export const CONF_LEVELS = ['static', 'resolved', 'semantic', 'runtime'] as const
export const CONF_BLURB: Record<string, string> = {
  static: 'Discovered by AST parse — names, shapes, source spans.',
  resolved: 'Imports resolved — schemas and references trusted.',
  semantic: 'Semantically enriched — facts and control inferred.',
  runtime: 'Confirmed against real run spans.',
  partial: 'Discovered but some import-only data is missing.',
}

export function ConfidenceMeter({
  value = 'static',
  showLabel = true,
  compact = false,
}: {
  value?: string
  showLabel?: boolean
  compact?: boolean
}) {
  const isPartial = value === 'partial'
  const idx = (CONF_LEVELS as readonly string[]).indexOf(value)
  const tone: Tone = isPartial ? 'warn' : idx >= 3 ? 'crux' : idx >= 2 ? 'ok' : idx >= 1 ? 'iris' : 'muted'
  const c = toneColor(T, tone)
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }} title={CONF_BLURB[value]}>
      <span style={{ display: 'inline-flex', gap: 2 }}>
        {CONF_LEVELS.map((lvl, i) => {
          const on = !isPartial && i <= idx
          return (
            <span
              key={lvl}
              style={{
                width: compact ? 5 : 7,
                height: compact ? 5 : 7,
                borderRadius: 1.5,
                background: on ? c.fg : T.bgSubtle,
                boxShadow: on ? 'none' : `inset 0 0 0 1px ${T.border}`,
              }}
            />
          )
        })}
      </span>
      {showLabel && (
        <span style={{ fontFamily: T.mono, fontSize: 10.5, color: c.fg, letterSpacing: '0.04em' }}>{value}</span>
      )}
    </span>
  )
}

// ── indexing status (IDE-style freshness) ────────────────────────────────────
const INDEX_STATUS: Record<string, { tone: Tone; label: string; pulse?: boolean }> = {
  cold: { tone: 'muted', label: 'cold' },
  cached: { tone: 'crux', label: 'cached' },
  refreshing: { tone: 'warn', label: 'refreshing', pulse: true },
  ready: { tone: 'ok', label: 'ready' },
  degraded: { tone: 'danger', label: 'degraded' },
}
const SUB_STATUS: Record<string, Tone> = {
  disabled: 'muted',
  pending: 'muted',
  running: 'warn',
  ready: 'ok',
  degraded: 'danger',
}

function SubStatus({ label, sub }: { label: string; sub?: { status: string } }) {
  if (!sub) return null
  const sc = toneColor(T, SUB_STATUS[sub.status] ?? 'muted')
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontFamily: T.mono,
        fontSize: 10.5,
        color: T.fgMuted,
      }}
    >
      <span style={{ color: T.fgFaint }}>{label}</span>
      <span style={{ width: 4, height: 4, borderRadius: 99, background: sc.fg }} />
      <span style={{ color: sc.fg }}>{sub.status}</span>
    </span>
  )
}

export function IndexingStatus({ indexing }: { indexing?: ProjectIndexingStatus }) {
  if (!indexing) return null
  const s = INDEX_STATUS[indexing.status] ?? INDEX_STATUS.cold
  const c = toneColor(T, s.tone)
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '3px 9px',
          borderRadius: 6,
          background: c.soft,
          boxShadow: `inset 0 0 0 1px ${c.line}`,
          fontFamily: T.mono,
          fontSize: 11,
          fontWeight: 500,
          color: c.fg,
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 99,
            background: c.fg,
            color: c.fg,
            animation: s.pulse ? 'index-pulse 1.4s ease-out infinite' : 'none',
          }}
        />
        indexed · {s.label}
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
        <SubStatus label="AST" sub={indexing.ast} />
        <SubStatus label="semantic" sub={indexing.semantic} />
      </span>
    </div>
  )
}

// ── meta row (source · fingerprint · updated) ────────────────────────────────
export interface MetaItem {
  label?: string
  value: ReactNode
  tone?: Tone
}
export function MetaRow({ items, gap = 14 }: { items: Array<MetaItem | false | null | undefined>; gap?: number }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap, fontFamily: T.mono, fontSize: 11, color: T.fgMuted }}>
      {items
        .filter((x): x is MetaItem => Boolean(x))
        .map((it, i) => (
          <span key={i}>
            {it.label && <span style={{ color: T.fgFaint }}>{it.label} · </span>}
            <span style={{ color: it.tone ? toneColor(T, it.tone).fg : undefined }}>{it.value}</span>
          </span>
        ))}
    </div>
  )
}

// ── small section label ──────────────────────────────────────────────────────
export function SectionLabel({ children, right, mt = 0 }: { children: ReactNode; right?: ReactNode; mt?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: mt, marginBottom: 12 }}>
      <span
        style={{
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: T.fgFaint,
        }}
      >
        {children}
      </span>
      <div style={{ flex: 1, height: 1, background: T.border }} />
      {right}
    </div>
  )
}

// ── thin labelled bar ────────────────────────────────────────────────────────
export function Bar({
  value = 0,
  max = 1,
  tone = 'crux',
  height = 6,
  track,
}: {
  value?: number
  max?: number
  tone?: Tone
  height?: number
  track?: string
}) {
  const c = toneColor(T, tone)
  return (
    <div style={{ flex: 1, height, background: track ?? T.bgSubtle, borderRadius: 99, overflow: 'hidden' }}>
      <div
        style={{
          width: `${Math.max(0, Math.min(1, value / max)) * 100}%`,
          height: '100%',
          background: c.fg,
          borderRadius: 99,
        }}
      />
    </div>
  )
}

// ── injection conditionality vocabulary (v2) ─────────────────────────────────
// `useEntries` / `inputContributions` carry a `conditionality`. Three reading
// groups: ALWAYS (guaranteed, calm), CONDITIONAL (when / match / guard — the
// branchy ones the eye should catch), DYNAMIC (not statically resolvable —
// rendered dashed so "we don't fully know" is unmistakable).
export type InjectConditionality =
  | 'always'
  | 'when'
  | 'match-case'
  | 'match-default'
  | 'binary-guard'
  | 'dynamic'
  | 'unknown'
export type InjectGroup = 'always' | 'conditional' | 'dynamic'

export interface InjectCondMeta {
  label: string
  group: InjectGroup
  tone: Tone
  blurb: string
}

export const INJECT_COND: Record<InjectConditionality, InjectCondMeta> = {
  always: { label: 'always', group: 'always', tone: 'ok', blurb: 'Injected on every assembly.' },
  when: {
    label: 'when',
    group: 'conditional',
    tone: 'warn',
    blurb: 'Injected only when a predicate holds — when(...).',
  },
  'match-case': {
    label: 'match',
    group: 'conditional',
    tone: 'warn',
    blurb: 'Injected in a specific match(...) branch.',
  },
  'match-default': {
    label: 'match · default',
    group: 'conditional',
    tone: 'warn',
    blurb: 'Injected in the match(...) default branch.',
  },
  'binary-guard': { label: 'guard', group: 'conditional', tone: 'warn', blurb: 'Injected behind a && guard.' },
  dynamic: { label: 'runtime-dependent', group: 'dynamic', tone: 'muted', blurb: 'Prepared or filtered at runtime.' },
  unknown: { label: 'unknown', group: 'dynamic', tone: 'muted', blurb: 'Injection could not be classified.' },
}

export interface InjectGroupMeta {
  id: InjectGroup
  label: string
  tone: Tone
  note: string
}

export const INJECT_GROUPS: InjectGroupMeta[] = [
  { id: 'always', label: 'Always', tone: 'ok', note: 'guaranteed on every assembly' },
  { id: 'conditional', label: 'Conditional', tone: 'warn', note: 'only under a branch or predicate' },
  { id: 'dynamic', label: 'Runtime-dependent', tone: 'muted', note: 'prepared or filtered at runtime' },
]

export function injectCondMeta(c?: string): InjectCondMeta {
  return INJECT_COND[(c as InjectConditionality) ?? 'unknown'] ?? INJECT_COND.unknown
}

export function injectGroupOf(c?: string): InjectGroup {
  return injectCondMeta(c).group
}

/** relationHint → a kind we can glyph when the entry didn't resolve to a def. */
export const INJECT_REL_KIND: Record<string, string> = {
  context: 'context',
  injectable: 'injectable',
  memory: 'memory',
  blackboard: 'blackboard',
  unknown: 'unknown',
}

/** Small mono pill carrying one entry's / contribution's conditionality (+ optional branch). */
export function InjectTag({
  conditionality = 'always',
  branch,
  showBranch = false,
  size = 'sm',
}: {
  conditionality?: string
  branch?: string
  showBranch?: boolean
  size?: 'xs' | 'sm'
}) {
  const m = injectCondMeta(conditionality)
  const dynamic = m.group === 'dynamic'
  const c = toneColor(T, m.tone)
  const fs = size === 'xs' ? 9 : 9.5
  const showB = showBranch && branch && !m.label.toLowerCase().includes(String(branch).toLowerCase())
  return (
    <span
      title={m.blurb + (branch ? ` · ${branch}` : '')}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontFamily: T.mono,
        fontSize: fs,
        letterSpacing: '0.03em',
        color: dynamic ? T.fgMuted : c.fg,
        whiteSpace: 'nowrap',
        padding: '1px 6px',
        borderRadius: 4,
        background: dynamic ? 'transparent' : c.soft,
        border: dynamic ? `1px dashed ${T.borderStrong ?? T.border}` : `1px solid ${c.soft}`,
      }}
    >
      <span
        style={{
          width: 4,
          height: 4,
          borderRadius: 99,
          background: dynamic ? 'transparent' : c.fg,
          boxShadow: dynamic ? `inset 0 0 0 1px ${T.fgFaint}` : 'none',
        }}
      />
      {m.label}
      {showB && <span style={{ color: T.fgFaint, fontWeight: 400 }}>· {branch}</span>}
    </span>
  )
}

// ── injection resolution state (the shared, cross-plane vocabulary) ──────────
// What a RUN did with an injectable at resolution time — the fifth status
// vocabulary and the one shared *across* planes (the catalog Observed layer
// and the run-level Context pane render it identically). Authored certainty
// (`InjectTag`) stays distinct from this observed state:
//   active   → contributed to the assembled context
//   checked  → predicate false / branch not taken — NOT a drop (`checked ≠ dropped`)
//   dropped  → lost the token budget at assembly time
//   disabled → inline-disabled for this run
//   unknown  → older / partial telemetry; state not recorded
export type InjectState = 'active' | 'checked' | 'dropped' | 'disabled' | 'unknown'

export interface InjectStateMeta {
  tone: Tone
  label: string
  /** Solid fill (active) vs hollow ring (everything quieter). */
  solid: boolean
  blurb: string
}

export const INJECT_STATE: Record<InjectState, InjectStateMeta> = {
  active: { tone: 'ok', label: 'active', solid: true, blurb: 'Contributed to the assembled context.' },
  checked: {
    tone: 'warn',
    label: 'checked · not included',
    solid: false,
    blurb: 'Evaluated but its predicate was false / branch not taken — not a drop.',
  },
  dropped: {
    tone: 'danger',
    label: 'dropped · budget',
    solid: false,
    blurb: 'Lost the token budget at assembly time.',
  },
  disabled: { tone: 'muted', label: 'disabled', solid: false, blurb: 'Inline-disabled for this run.' },
  unknown: { tone: 'muted', label: 'unknown', solid: false, blurb: 'Older or partial telemetry — state not recorded.' },
}

export type InjectStateCounts = Partial<Record<InjectState, number>>

export const INJECT_STATE_ORDER: InjectState[] = ['active', 'checked', 'dropped', 'disabled', 'unknown']

export function injectStateMeta(s?: string): InjectStateMeta {
  return INJECT_STATE[(s as InjectState) ?? 'unknown'] ?? INJECT_STATE.unknown
}

/** The dominant (mode) state of a distribution — the one the footnote leads with. */
export function dominantInjectState(counts: InjectStateCounts): InjectState {
  let best: InjectState = 'unknown'
  let bestN = -1
  for (const s of INJECT_STATE_ORDER) {
    const n = counts[s] ?? 0
    if (n > bestN) {
      bestN = n
      best = s
    }
  }
  return best
}

/** One resolution-state chip — dot + label; saturated fill only for `active`. */
export function InjectStateChip({ state, count, size = 'sm' }: { state: string; count?: number; size?: 'xs' | 'sm' }) {
  const m = injectStateMeta(state)
  const c = toneColor(T, m.tone)
  const fs = size === 'xs' ? 9.5 : 10.5
  return (
    <span
      title={m.blurb}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: size === 'xs' ? '1px 6px' : '2px 8px',
        borderRadius: 4,
        whiteSpace: 'nowrap',
        fontFamily: T.mono,
        fontSize: fs,
        letterSpacing: '0.02em',
        color: m.solid ? c.fg : T.fgMuted,
        background: m.solid ? c.soft : 'transparent',
        boxShadow: `inset 0 0 0 1px ${m.solid ? c.line : T.border}`,
      }}
    >
      {m.solid ? (
        <span style={{ width: 4, height: 4, borderRadius: 99, background: c.fg, flex: '0 0 auto' }} />
      ) : (
        <span
          style={{
            width: 4,
            height: 4,
            borderRadius: 99,
            background: 'transparent',
            boxShadow: `inset 0 0 0 1.5px ${c.fg}`,
            flex: '0 0 auto',
          }}
        />
      )}
      {m.label}
      {count != null && <span style={{ color: T.fgFaint, fontWeight: 600 }}>· {count}</span>}
    </span>
  )
}

/** A one-source distribution — the same tones stacked into a magnitude bar. */
export function InjectStateBar({ counts, height = 6 }: { counts: InjectStateCounts; height?: number }) {
  const total = INJECT_STATE_ORDER.reduce((n, s) => n + (counts[s] ?? 0), 0)
  return (
    <span
      style={{
        display: 'inline-flex',
        width: '100%',
        height,
        borderRadius: 99,
        overflow: 'hidden',
        background: T.bgSubtle,
        boxShadow: `inset 0 0 0 1px ${T.border}`,
      }}
      title={INJECT_STATE_ORDER.filter((s) => counts[s])
        .map((s) => `${injectStateMeta(s).label}: ${counts[s]}`)
        .join(' · ')}
    >
      {total > 0 &&
        INJECT_STATE_ORDER.map((s) => {
          const n = counts[s] ?? 0
          if (!n) return null
          const m = INJECT_STATE[s]
          const c = toneColor(T, m.tone)
          return (
            <span
              key={s}
              style={{
                width: `${(n / total) * 100}%`,
                height: '100%',
                // keep the quiet states legible against the track without shouting
                background: m.solid ? c.fg : c.soft,
                boxShadow: m.solid ? 'none' : `inset 0 0 0 1px ${c.line}`,
              }}
            />
          )
        })}
    </span>
  )
}

// ── lint / health vocabulary ─────────────────────────────────────────────────
// Severity is the one lint signal allowed saturated colour, and only the two
// that demand action. `info` is NEUTRAL (a hollow dot) — never iris, which is
// the Authoring family hue. A definition with zero findings reads ok-green.
// Shared by the board AND the Health surfaces — change a token here once and
// every surface follows. See the Index health kit handover §5.
export type LintSeverity = 'error' | 'warning' | 'info'
export type LintFixKindId = 'code-action' | 'config' | 'docs' | 'manual' | 'suppress'

export interface LintSevMeta {
  tone: Tone
  solid: boolean
  label: string
  verb: string
  blurb: string
}

export const LINT_SEVERITY: Record<LintSeverity, LintSevMeta> = {
  error: {
    tone: 'danger',
    solid: true,
    label: 'error',
    verb: 'must fix',
    blurb: 'Breaks at runtime or violates a hard contract.',
  },
  warning: {
    tone: 'warn',
    solid: true,
    label: 'warning',
    verb: 'should fix',
    blurb: 'A real architecture risk — not yet breaking.',
  },
  info: {
    tone: 'muted',
    solid: false,
    label: 'info',
    verb: 'consider',
    blurb: 'A nicety: opaque output, thin coverage, missing id.',
  },
}

export function lintSevMeta(s: string): LintSevMeta {
  return LINT_SEVERITY[s as LintSeverity] ?? LINT_SEVERITY.info
}

export interface LintFixKindMeta {
  label: string
  icon: string
  tone: Tone
  loud: boolean
  blurb: string
}

// fixes typed by kind; only code-action is "loud" (it edits for you).
export const LINT_FIX_KIND: Record<LintFixKindId, LintFixKindMeta> = {
  'code-action': {
    label: 'code action',
    icon: 'sparkle',
    tone: 'crux',
    loud: true,
    blurb: 'One-click automated edit.',
  },
  config: { label: 'config', icon: 'more', tone: 'blue', loud: false, blurb: 'Change lint or project config.' },
  docs: { label: 'docs', icon: 'link', tone: 'muted', loud: false, blurb: 'Open the rule’s guidance.' },
  manual: { label: 'manual', icon: 'tool', tone: 'muted', loud: false, blurb: 'Hand-edit, described in prose.' },
  suppress: { label: 'suppress', icon: 'x', tone: 'muted', loud: false, blurb: 'Disable inline — the escape hatch.' },
}

// analysis tier a rule needs to run: syntax < index < semantic (deepest).
export const LINT_TIER: Record<string, string> = {
  syntax: 'reads the AST only',
  index: 'needs resolved refs & relations',
  semantic: 'needs the semantic model — deepest',
}

/** Severity dot — solid for error/warning, hollow ring for the neutral info. */
export function LintSevDot({ severity, size = 8 }: { severity: string; size?: number }) {
  const m = lintSevMeta(severity)
  const c = toneColor(T, m.tone)
  return m.solid ? (
    <span style={{ width: size, height: size, borderRadius: 99, background: c.fg, flex: '0 0 auto' }} />
  ) : (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: 99,
        background: 'transparent',
        boxShadow: `inset 0 0 0 1.5px ${T.fgFaint}`,
        flex: '0 0 auto',
      }}
    />
  )
}

/** Severity chip — dot + label; saturated only for error/warning. */
export function LintSevChip({ severity }: { severity: string }) {
  const m = lintSevMeta(severity)
  const c = toneColor(T, m.tone)
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '2px 9px',
        borderRadius: 5,
        fontFamily: T.mono,
        fontSize: 11,
        fontWeight: 600,
        color: m.solid ? c.fg : T.fgMuted,
        background: m.solid ? c.soft : T.bg,
        boxShadow: `inset 0 0 0 1px ${m.solid ? c.line : T.border}`,
      }}
    >
      <LintSevDot severity={severity} size={7} />
      {m.label}
    </span>
  )
}

/** Quiet mono metadata tag — neutral unless explicitly toned. */
export function LintMetaTag({
  children,
  tone,
  dashed,
  title,
}: {
  children: ReactNode
  tone?: Tone
  dashed?: boolean
  title?: string
}) {
  const c = toneColor(T, tone ?? 'muted')
  return (
    <span
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '2px 8px',
        borderRadius: 5,
        fontFamily: T.mono,
        fontSize: 10.5,
        color: tone ? c.fg : T.fgMuted,
        background: T.bg,
        border: dashed ? `1px dashed ${T.fgFaint}` : `1px solid ${T.border}`,
      }}
    >
      {children}
    </span>
  )
}

/** Extension provenance — quiet; built-in rules show no marker at all. */
export function LintExtBadge({ extension }: { extension?: { name: string; version?: string } | null }) {
  if (!extension) return null
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '2px 8px',
        borderRadius: 5,
        fontFamily: T.mono,
        fontSize: 10.5,
        color: T.fgMuted,
        background: T.bgMuted,
        boxShadow: `inset 0 0 0 1px ${T.border}`,
      }}
    >
      <CatIcon name="inject" size={10} color={T.fgFaint} />
      {extension.name}
      {extension.version ? <span style={{ color: T.fgFaint }}>·{extension.version}</span> : null}
    </span>
  )
}

/** Three-dot confidence meter (high · medium · low). */
export function LintConfMeter({ value }: { value: string }) {
  const n = value === 'high' ? 3 : value === 'medium' ? 2 : 1
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{ display: 'inline-flex', gap: 2 }}>
        {[0, 1, 2].map((i) => (
          <span key={i} style={{ width: 4, height: 9, borderRadius: 1, background: i < n ? T.fgMuted : T.border }} />
        ))}
      </span>
      <span style={{ fontFamily: T.mono, fontSize: 10.5, color: T.fgFaint }}>{value}</span>
    </span>
  )
}

/** Typed fix chip — only `code-action` renders loud. */
export function LintFixKind({ kind }: { kind: string }) {
  const m = LINT_FIX_KIND[kind as LintFixKindId] ?? LINT_FIX_KIND.manual
  const c = toneColor(T, m.tone)
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 9px',
        borderRadius: 6,
        fontFamily: T.mono,
        fontSize: 10.5,
        fontWeight: m.loud ? 600 : 400,
        color: m.loud ? c.fg : T.fgMuted,
        background: m.loud ? c.soft : T.bg,
        boxShadow: `inset 0 0 0 1px ${m.loud ? c.line : T.border}`,
      }}
    >
      <Icon name={m.icon} size={11} color={m.loud ? c.fg : T.fgFaint} />
      {m.label}
    </span>
  )
}
