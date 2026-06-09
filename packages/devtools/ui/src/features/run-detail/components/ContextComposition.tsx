/**
 * Context composition pane — the **center** of the integrated Context tab.
 *
 * Substance vs layout (RUN-DETAIL-SPEC §9 + §14): §9 lists the Context pane's
 * substance — base prompt, injected contributions (4 states), composition bar,
 * accumulated context / messages, tools-in-request, **budget**, preview toggle.
 * Those all render here. What does NOT render is v15 `ContextDetailFull`'s rail
 * **summary widget** (the active/checked/dropped/disabled count grid + the
 * "checked ≠ dropped" explainer) — that is a standalone-study rail affordance, not
 * §9 substance, and the integrated right rail is the constant `SpanInspector`
 * (`v7-screens`: `StructureTree | GenerationDetail | SpanInspector`). Inlining the
 * count grid into the center would be invented layout (see DATA-COVERAGE A7).
 *
 * The assembled request as ONE composite blob: a single **base prompt** + many
 * **injected contributions** (`use[]`) + accumulated prior-turn context + tools.
 * Each contribution is a **collapsible** card — open it to read the resolved
 * text (with dynamic-var highlighting) — and carries its injectable kind, source
 * id, priority, size, cache status and a resolution **state**:
 *   active · checked·not-included · dropped·budget · disabled.
 * Plus a composition bar + legend, budget, contributing tools (`← source` from
 * `injectedTools`), and a composition ⇄ preview-full-prompt toggle.
 *
 * Binds to the backend's typed `context.contribution` + `prompt.budget` previews,
 * degrades to the resolved-context detail spans (`gatherResolvedContexts`).
 *
 * Static-vs-dynamic (backend B1): when a contribution / base-prompt preview carries
 * `segments[]` (`{ text, dynamic, source? }`), we render true static-vs-dynamic
 * highlighting with the dynamic span's source key. Base-prompt segments come from
 * `trace.inspect.system.parts` (`source: "prompt"`). Traces without `segments` fall
 * back to best-effort `{{var}}` / `${var}` template-marker highlighting.
 */

import { useMemo, useState, type ReactNode } from 'react'
import { Chip, Eyebrow } from '@/qw/shell/primitives'
import { Icon } from '@/qw/shell/Icon'
import { useNavigation, type NavState } from '@/app/navigation/useNavigation'
import type {
  CruxContextContributionPreview,
  CruxContextContributionState,
  CruxPromptBudgetPreview,
  CruxRunDetailRequest,
} from '@crux/core/observability'
import type { ObservabilityRunDetailNode, TextSegment, Trace } from '@/types'
import {
  findAllArtifacts,
  findArtifact,
  fmtTokens,
  gatherDescendants,
  gatherResolvedContexts,
  parsePartSource,
  resolveMessages,
} from '../lib/span-detail-inspection'

// ─── unified contribution model ─────────────────────────────────────

type InjKind = 'prompt' | 'context' | 'conditional' | 'match' | 'skill' | 'memory' | 'blackboard' | 'retrieval' | string

interface Contrib {
  id: string
  kind: InjKind
  state: CruxContextContributionState
  tokens?: number
  sizeBytes?: number
  cache?: string
  injects?: string
  reason?: string
  text?: string
  priority?: number
  basePrompt?: boolean
  injectedTools?: readonly string[]
  segments?: readonly TextSegment[]
  staticTokens?: number
  dynamicTokens?: number
  /** Backend compose order (B4 `request.contributions[].order`); stabilizes the bar. */
  order?: number
}

const INJ_COLOR: Record<string, string> = {
  prompt: 'var(--qw-fg)',
  context: 'var(--qw-crux)',
  conditional: 'var(--qw-warn)',
  match: 'var(--qw-warn)',
  skill: 'var(--qw-iris)',
  memory: 'var(--qw-iris)',
  blackboard: 'var(--qw-iris)',
  retrieval: 'var(--qw-ok)',
  retriever: 'var(--qw-ok)',
}
const injLabel = (k: InjKind): string => (k === 'retrieval' ? 'retriever' : String(k))

function isContribution(p: unknown): p is CruxContextContributionPreview {
  return typeof p === 'object' && p !== null && (p as { kind?: unknown }).kind === 'context.contribution'
}
function isBudget(p: unknown): p is CruxPromptBudgetPreview {
  return typeof p === 'object' && p !== null && (p as { kind?: unknown }).kind === 'prompt.budget'
}

export function hasContextContributions(node: ObservabilityRunDetailNode): boolean {
  return (
    // B4: a backend-composed request is the authoritative source.
    (node.request != null && ((node.request.contributions?.length ?? 0) > 0 || node.request.basePrompt != null)) ||
    findAllArtifacts(node, 'context.contribution').some((a) => isContribution(a.preview)) ||
    isBudget(findArtifact(node, 'prompt.budget')?.preview) ||
    gatherResolvedContexts(node).length > 0
  )
}

function tokFromBytes(bytes?: number): number | undefined {
  return bytes != null ? Math.round(bytes / 4) : undefined
}

function buildContribs(node: ObservabilityRunDetailNode): {
  contribs: Contrib[]
  budget: CruxPromptBudgetPreview | null
} {
  const fromArtifacts = findAllArtifacts(node, 'context.contribution')
    .map((a) => a.preview)
    .filter(isContribution)
  const budgetPreview = findArtifact(node, 'prompt.budget')?.preview
  const budget = isBudget(budgetPreview) ? budgetPreview : null

  if (fromArtifacts.length > 0 || budget) {
    // Dedup by sourceId. A context that re-resolves on every generation step
    // (e.g. a `generation.stream` wrapping N `generation.call`s, or an agent
    // loop) emits one `context.contribution` per step — `findAllArtifacts`
    // walks the whole subtree, so without dedup the same context renders N
    // times. Keep the most informative instance: prefer segments, then text,
    // then resolution-state rank (active > checked > dropped > disabled).
    const score = (c: CruxContextContributionPreview): number =>
      (c.segments?.length ? 4 : 0) + (c.text ? 2 : 0) + (STATE_RANK[c.state] ?? 0) / 10
    const byId = new Map<string, CruxContextContributionPreview>()
    for (const c of fromArtifacts) {
      const ex = byId.get(c.sourceId)
      if (!ex || score(c) > score(ex)) byId.set(c.sourceId, c)
    }
    for (const d of budget?.dropped ?? []) {
      if (!byId.has(d.sourceId)) byId.set(d.sourceId, d)
    }
    const all = [...byId.values()]
    return {
      budget,
      contribs: all.map((c) => ({
        id: c.sourceId,
        kind: c.injectableKind,
        state: c.state,
        tokens: c.tokens ?? tokFromBytes(c.sizeBytes),
        sizeBytes: c.sizeBytes,
        cache: c.cacheStatus,
        injects: c.injects?.join(' + '),
        reason: c.reason,
        text: c.text,
        priority: c.priority,
        basePrompt: c.injectableKind === 'prompt',
        injectedTools: c.injectedTools,
        segments: c.segments,
        staticTokens: c.staticTokens,
        dynamicTokens: c.dynamicTokens,
      })),
    }
  }

  const resolved = gatherResolvedContexts(node)
  return {
    budget: null,
    contribs: resolved.map((c) => ({
      id: c.label,
      kind: c.family,
      state: (c.hasPredicate && !c.text ? 'checked-not-included' : 'active') as CruxContextContributionState,
      tokens: tokFromBytes(c.sizeBytes),
      sizeBytes: c.sizeBytes,
      reason: c.hasPredicate && !c.text ? 'predicate false / not included' : undefined,
      text: c.text,
      priority: c.priority,
      basePrompt: c.family === 'prompt',
    })),
  }
}

// ─── B4: authoritative per-node request composition ────────────────
//
// When the backend projects a `node.request` (the composed, deduped, ordered
// request for this span — `mode: exact` for a generation, `aggregate` for a
// stream/agent/composition using its representative final generation), we render
// it **verbatim** instead of walking the subtree + deduping client-side. The
// `buildContribs` heuristic below stays only as the fallback for older traces.

interface ComposedRequest {
  contribs: Contrib[]
  budget: CruxPromptBudgetPreview | null
  messages: { messages: readonly unknown[]; system?: string; prompt?: string }
  tools: { name: string; used: boolean }[]
  toolSource: Map<string, { sourceId: string; kind: InjKind }>
  requestMode: string
  representative?: CruxRunDetailRequest['representative']
  turns?: CruxRunDetailRequest['turns']
}

function contribFromRequestPreview(c: CruxRunDetailRequest['contributions'][number]): Contrib {
  return {
    id: c.sourceId,
    kind: c.injectableKind,
    state: c.state,
    tokens: c.tokens ?? tokFromBytes(c.sizeBytes),
    sizeBytes: c.sizeBytes,
    cache: c.cacheStatus,
    injects: c.injects?.join(' + '),
    reason: c.reason,
    text: c.text,
    priority: c.priority,
    basePrompt: false,
    injectedTools: c.injectedTools,
    segments: c.segments,
    staticTokens: c.staticTokens,
    dynamicTokens: c.dynamicTokens,
    order: c.order,
  }
}

function baseFromRequest(bp: NonNullable<CruxRunDetailRequest['basePrompt']>): Contrib {
  return {
    id: bp.sourceId === 'prompt' ? 'base-prompt' : bp.sourceId,
    kind: 'prompt',
    state: 'active',
    text: bp.text,
    segments: bp.segments,
    tokens: bp.tokens,
    staticTokens: bp.staticTokens,
    dynamicTokens: bp.dynamicTokens,
    basePrompt: true,
  }
}

function buildFromRequest(request: CruxRunDetailRequest, node: ObservabilityRunDetailNode): ComposedRequest {
  const injected = (request.contributions ?? []).map(contribFromRequestPreview)
  const base = request.basePrompt ? baseFromRequest(request.basePrompt) : undefined
  const contribs = base ? [base, ...injected] : injected

  // "used this turn" comes from descendant tool.call spans (the backend request
  // lists the offered toolset; whether each fired is structural).
  const used = new Set<string>()
  for (const d of gatherDescendants(node)) {
    if (d.toolName) used.add(d.toolName)
    else if (d.primitive === 'tool.call' && d.name) used.add(d.name)
  }
  const kindBySource = new Map<string, InjKind>()
  for (const c of request.contributions ?? []) kindBySource.set(c.sourceId, c.injectableKind)
  const toolSource = new Map<string, { sourceId: string; kind: InjKind }>()
  const tools = (request.tools ?? []).map((t) => {
    if (t.origin === 'injected' && t.sourceId)
      toolSource.set(t.name, { sourceId: t.sourceId, kind: kindBySource.get(t.sourceId) ?? 'context' })
    return { name: t.name, used: used.has(t.name) }
  })

  const m = request.messages ?? {}
  return {
    contribs,
    budget: request.budget ?? null,
    messages: {
      messages: Array.isArray(m.messages) ? (m.messages as unknown[]) : [],
      system: typeof m.system === 'string' ? m.system : undefined,
      prompt: typeof m.prompt === 'string' ? m.prompt : undefined,
    },
    tools,
    toolSource,
    requestMode: request.mode,
    representative: request.representative,
    turns: request.turns,
  }
}

// ─── state badge ────────────────────────────────────────────────────

/** Representativeness rank when deduping repeated contributions (higher wins). */
const STATE_RANK: Record<CruxContextContributionState, number> = {
  active: 3,
  'checked-not-included': 2,
  'dropped-budget': 1,
  disabled: 0,
}

const STATE_META: Record<CruxContextContributionState, { label: string; color: string }> = {
  active: { label: 'active', color: 'var(--qw-ok)' },
  'checked-not-included': { label: 'checked · not included', color: 'var(--qw-warn)' },
  'dropped-budget': { label: 'dropped · budget', color: 'var(--qw-danger)' },
  disabled: { label: 'disabled', color: 'var(--qw-fg-faint)' },
}

function StateBadge({ state }: { state: CruxContextContributionState }) {
  const m = STATE_META[state]
  return (
    <span
      className="whitespace-nowrap rounded-[3px] px-1.5 font-mono text-[9px]"
      style={{
        color: m.color,
        background: state === 'active' ? 'var(--qw-ok-soft)' : 'transparent',
        boxShadow: `inset 0 0 0 1px ${m.color}`,
      }}
    >
      {m.label}
    </span>
  )
}

const COMP_TINTS = [
  'var(--qw-ok)',
  'var(--qw-crux)',
  'var(--qw-iris)',
  'var(--qw-warn)',
  'var(--qw-fg-muted)',
  'var(--qw-danger)',
]

function fmtSize(c: { sizeBytes?: number; tokens?: number }): string {
  if (c.sizeBytes != null) return `${(c.sizeBytes / 1024).toFixed(c.sizeBytes >= 1024 ? 1 : 2)} kB`
  if (c.tokens != null) return `${fmtTokens(c.tokens)} tok`
  return ''
}

/** Real static-vs-dynamic rendering from backend B1 `segments`: static spans plain,
 *  dynamic spans highlighted and labelled with their `source` key. */
function renderSegments(segments: readonly TextSegment[]): { nodes: ReactNode; dyn: number } {
  let dyn = 0
  const nodes = segments.map((s, i) => {
    if (!s.dynamic) return <span key={i}>{s.text}</span>
    dyn++
    return (
      <span
        key={i}
        style={{
          background: 'var(--qw-crux-soft)',
          boxShadow: 'inset 0 0 0 1px var(--qw-crux-line)',
          borderRadius: 3,
          padding: '1px 3px',
        }}
      >
        {s.text}
        {s.source && (
          <sub className="font-mono" style={{ fontSize: 8.5, color: 'var(--qw-crux)' }}>
            {' '}
            {s.source}
          </sub>
        )}
      </span>
    )
  })
  return { nodes, dyn }
}

/** Fallback dynamic highlighting when the trace predates B1 `segments`: mark
 *  literal `{{var}}` / `${var}` template spans present in the resolved text. */
function renderText(text: string): { nodes: ReactNode; dyn: number } {
  const parts = text.split(/(\{\{[^}]+\}\}|\$\{[^}]+\})/g)
  let dyn = 0
  const nodes = parts.map((p, i) => {
    const m = p.match(/^\{\{([^}]+)\}\}$/) ?? p.match(/^\$\{([^}]+)\}$/)
    if (m) {
      dyn++
      return (
        <span
          key={i}
          style={{
            background: 'var(--qw-crux-soft)',
            boxShadow: 'inset 0 0 0 1px var(--qw-crux-line)',
            borderRadius: 3,
            padding: '1px 3px',
          }}
        >
          {p}
          <sub className="font-mono" style={{ fontSize: 8.5, color: 'var(--qw-crux)' }}>
            {' '}
            {m[1].trim()}
          </sub>
        </span>
      )
    }
    return <span key={i}>{p}</span>
  })
  return { nodes, dyn }
}

// ─── collapsible contribution card ──────────────────────────────────

function ContributionRow({
  c,
  navigate,
  defaultOpen = false,
  isBase = false,
}: {
  c: Contrib
  navigate: (s: NavState) => void
  defaultOpen?: boolean
  isBase?: boolean
}) {
  const hasSegments = !!(c.segments && c.segments.length > 0)
  const hasText = hasSegments || !!c.text
  const [open, setOpen] = useState(defaultOpen && hasText)
  const color = INJ_COLOR[c.kind] ?? 'var(--qw-fg-muted)'
  const skip = c.state !== 'active'
  const rendered = hasSegments ? renderSegments(c.segments!) : c.text ? renderText(c.text) : null
  const to: NavState =
    c.kind === 'prompt' ? { view: 'library-index', promptId: c.id } : { view: 'library-index', contextId: c.id }

  return (
    <div
      className="overflow-hidden rounded-[8px]"
      style={{
        background: skip ? 'transparent' : 'var(--qw-bg-elev)',
        border: `1px ${skip ? 'dashed' : 'solid'} ${isBase ? 'var(--qw-crux-line)' : 'var(--qw-border)'}`,
        opacity: c.state === 'disabled' ? 0.5 : skip ? 0.72 : 1,
      }}
    >
      <div
        className={`flex items-start gap-2.5 px-3 py-2 ${hasText ? 'cursor-pointer' : ''}`}
        style={
          isBase
            ? { background: 'var(--qw-crux-soft)', borderBottom: open ? '1px solid var(--qw-crux-line)' : 'none' }
            : undefined
        }
        onClick={hasText ? () => setOpen((v) => !v) : undefined}
      >
        {hasText ? (
          <Icon name={open ? 'arrowDown' : 'arrowRight'} size={12} color="var(--qw-fg-faint)" />
        ) : (
          <span
            className="shrink-0 self-stretch rounded-full"
            style={{ width: 3, background: skip ? 'var(--qw-fg-faint)' : color }}
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[8.5px] uppercase tracking-[0.05em]" style={{ color }}>
              {injLabel(c.kind)}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                navigate(to)
              }}
              className="font-mono text-[11.5px] font-medium hover:underline"
              style={{
                color: skip ? 'var(--qw-fg-muted)' : 'var(--qw-fg)',
                textDecoration: c.state === 'dropped-budget' ? 'line-through' : undefined,
              }}
            >
              {c.id}
            </button>
            {rendered && rendered.dyn > 0 && (
              <span
                className="rounded-[3px] px-1 font-mono text-[9px]"
                style={{ color: 'var(--qw-crux)', background: 'var(--qw-crux-soft)' }}
              >
                {rendered.dyn} dynamic
              </span>
            )}
            <Icon name="link" size={10} color="var(--qw-fg-faint)" />
            <StateBadge state={c.state} />
          </div>
          {(c.injects || c.reason) && (
            <div className="mt-1 text-[11px]" style={{ color: 'var(--qw-fg-muted)' }}>
              {c.injects && <>injects: {c.injects}</>}
              {c.reason && (
                <span style={{ color: c.state === 'dropped-budget' ? 'var(--qw-danger)' : 'var(--qw-warn)' }}>
                  {' '}
                  · {c.reason}
                </span>
              )}
            </div>
          )}
        </div>
        <div
          className="flex shrink-0 flex-col items-end gap-0.5 font-mono text-[10px]"
          style={{ color: 'var(--qw-fg-faint)' }}
        >
          <span>
            {c.priority != null ? `p${c.priority}` : ''}
            {fmtSize(c) ? `${c.priority != null ? ' · ' : ''}${fmtSize(c)}` : ''}
          </span>
          {c.cache && (
            <span
              style={{
                color:
                  c.cache === 'hit'
                    ? 'var(--qw-ok)'
                    : c.cache === 'disabled'
                      ? 'var(--qw-fg-faint)'
                      : 'var(--qw-fg-muted)',
              }}
            >
              cache {c.cache}
            </span>
          )}
        </div>
      </div>
      {open && rendered && (
        <div
          className="whitespace-pre-wrap px-4 py-3 text-[13px] leading-[1.7]"
          style={{ fontFamily: 'var(--qw-serif)' }}
        >
          {rendered.nodes}
        </div>
      )}
    </div>
  )
}

// ─── component ──────────────────────────────────────────────────────

export function ContextComposition({
  node,
  trace,
  providedTools,
}: {
  node: ObservabilityRunDetailNode
  trace?: Trace
  isRoot?: boolean
  /** The full request toolset (declared + used), computed upstream from the
   *  agent ancestor. Falls back to local derivation when not supplied. */
  providedTools?: { name: string; used: boolean }[]
}) {
  const { navigate } = useNavigation()
  const [mode, setMode] = useState<'composition' | 'preview'>('composition')

  // B4: the backend-composed `node.request` is authoritative, but on many nodes
  // it's sparse (a stream/agent request may carry 0 contributions; a leaf
  // generation may list 0 tools) while the subtree-walk fallback still has the
  // real contexts + the agent-ancestor toolset. So we pick the *richer* source
  // per facet instead of blindly preferring `request` (which emptied the pane).
  const req = useMemo(() => (node.request ? buildFromRequest(node.request, node) : null), [node])
  const fb = useMemo(() => buildContribs(node), [node])
  const fbMessages = useMemo(() => resolveMessages(node), [node])

  // UNION the backend request's contributions with the subtree-walk fallback,
  // preferring the request's version per id (it carries `order` + B1 segments).
  // Union — NOT either/or — so the tile *set* never swaps between sources across
  // refetches (that swap was the main cause of the bar reshuffling). Deterministic
  // order: base prompt first, then backend compose `order` (else priority desc),
  // `id` as a stable final tiebreak. Memoized so the bar gets a referentially
  // stable array while `node` is unchanged.
  const orderedContribs = useMemo(() => {
    const byId = new Map<string, Contrib>()
    for (const c of fb.contribs) if (!c.basePrompt) byId.set(c.id, c)
    for (const c of req?.contribs ?? []) if (!c.basePrompt) byId.set(c.id, c)
    const baseC = req?.contribs.find((c) => c.basePrompt) ?? fb.contribs.find((c) => c.basePrompt)
    const all = baseC ? [baseC, ...byId.values()] : [...byId.values()]
    // Order: base prompt first, then the backend's monotonic `order` (B10 — the
    // RunDetail projection now assigns deterministic, server-owned order values,
    // so rendering it directly is both faithful to compose order AND stable across
    // refetches). Contributions without `order` (subtree fallback) sort after, by
    // priority desc then `id` — also deterministic.
    return all.sort((a, b) => {
      if (!!a.basePrompt !== !!b.basePrompt) return a.basePrompt ? -1 : 1
      if (a.order != null && b.order != null) return a.order - b.order
      if (a.order != null) return -1
      if (b.order != null) return 1
      const pa = a.priority ?? Number.NEGATIVE_INFINITY
      const pb = b.priority ?? Number.NEGATIVE_INFINITY
      if (pa !== pb) return pb - pa
      return a.id.localeCompare(b.id)
    })
  }, [req, fb])
  const budget = req?.budget ?? fb.budget
  const messages: { messages: readonly unknown[]; system?: string; prompt?: string } =
    req?.messages && (req.messages.system || req.messages.messages.length > 0) ? req.messages : fbMessages

  // tool → contribution that injected it (B3: `injectedTools` per contribution)
  const fbTools = useMemo(() => {
    if (providedTools && providedTools.length > 0) return providedTools
    const used = new Set<string>()
    for (const d of gatherDescendants(node)) {
      if (d.toolName) used.add(d.toolName)
      else if (d.primitive === 'tool.call' && d.name) used.add(d.name)
    }
    const all = new Set<string>(used)
    for (const t of trace?.inspect?.tools ?? []) if (typeof t === 'string') all.add(t)
    return Array.from(all)
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ name, used: used.has(name) }))
  }, [node, trace, providedTools])
  const fbToolSource = useMemo(() => {
    const m = new Map<string, { sourceId: string; kind: InjKind }>()
    for (const c of fb.contribs) {
      for (const tn of c.injectedTools ?? []) if (!m.has(tn)) m.set(tn, { sourceId: c.id, kind: c.kind })
    }
    return m
  }, [fb])

  // Tools: prefer the request's source-tagged set, but fall back to the agent
  // ancestor's full toolset when the request lists none (common on these traces).
  const useReqTools = (req?.tools.length ?? 0) > 0
  const tools = useReqTools ? req!.tools : fbTools
  const toolSource = useReqTools ? req!.toolSource : fbToolSource

  const hasInspectSystem = (trace?.inspect?.system?.parts?.length ?? 0) > 0
  if (
    orderedContribs.length === 0 &&
    !budget &&
    !messages.system &&
    messages.messages.length === 0 &&
    !hasInspectSystem
  ) {
    return (
      <div
        className="rounded-[10px] px-6 py-10 text-center text-[12.5px]"
        style={{ border: '1px dashed var(--qw-border)', color: 'var(--qw-fg-muted)' }}
      >
        No context composition captured for this generation.
      </div>
    )
  }

  const active = orderedContribs.filter((c) => c.state === 'active')
  const base = orderedContribs.find((c) => c.basePrompt)
  const injected = orderedContribs.filter((c) => !c.basePrompt)
  const counts: Record<CruxContextContributionState, number> = {
    active: active.length,
    'checked-not-included': orderedContribs.filter((c) => c.state === 'checked-not-included').length,
    'dropped-budget': orderedContribs.filter((c) => c.state === 'dropped-budget').length,
    disabled: orderedContribs.filter((c) => c.state === 'disabled').length,
  }
  const activeBytes = active.reduce((s, c) => s + (c.sizeBytes ?? 0), 0)
  const activeTokens = active.reduce((s, c) => s + (c.tokens ?? 0), 0)
  const compBarTotal = Math.max(1, activeBytes || activeTokens)

  // Base prompt: prefer the prompt contribution; else the inspect `system.parts`
  // entry with `source: "prompt"` (carries B1 segments); else the system message.
  const basePromptPart = trace?.inspect?.system?.parts?.find(
    (p) => parsePartSource(p.source).kind === 'prompt' && !p.skipped,
  )
  const baseContrib: Contrib | undefined = base
    ? {
        ...base,
        text: base.text ?? basePromptPart?.text ?? messages.system ?? undefined,
        segments: base.segments ?? basePromptPart?.segments,
        staticTokens: base.staticTokens ?? basePromptPart?.staticTokens,
        dynamicTokens: base.dynamicTokens ?? basePromptPart?.dynamicTokens,
      }
    : basePromptPart || messages.system
      ? {
          id: 'base-prompt',
          kind: 'prompt',
          state: 'active',
          text: basePromptPart?.text ?? messages.system ?? undefined,
          segments: basePromptPart?.segments,
          staticTokens: basePromptPart?.staticTokens,
          dynamicTokens: basePromptPart?.dynamicTokens,
          tokens: basePromptPart?.tokens,
          basePrompt: true,
        }
      : undefined

  return (
    <div className="flex flex-col gap-4">
      {/* summary + mode toggle */}
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-muted)' }}>
          {counts.active} active · {counts['checked-not-included']} checked ·{' '}
          {counts['dropped-budget'] + counts.disabled} skipped ·{' '}
          {activeBytes ? `${(activeBytes / 1024).toFixed(1)} kB` : `${fmtTokens(activeTokens)} tok`}
        </span>
        <div className="flex-1" />
        <div
          className="inline-flex overflow-hidden rounded-[6px] font-mono text-[10.5px]"
          style={{ boxShadow: 'inset 0 0 0 1px var(--qw-border)' }}
        >
          {(['composition', 'preview'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className="px-2.5 py-[3px]"
              style={{
                background: mode === m ? 'var(--qw-crux-soft)' : 'transparent',
                color: mode === m ? 'var(--qw-crux)' : 'var(--qw-fg-faint)',
                fontWeight: mode === m ? 600 : 450,
              }}
            >
              {m === 'composition' ? 'composition' : 'preview full prompt'}
            </button>
          ))}
        </div>
      </div>

      {/* B4 aggregate: this is the representative/effective request the backend
          selected for a stream/agent/composition span (not a union of turns). */}
      {req?.requestMode === 'aggregate' && (req.contribs.length > 0 || (req.turns?.length ?? 0) > 0) && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-[8px] px-3 py-2 text-[11px]"
          style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)', color: 'var(--qw-fg-muted)' }}
        >
          <Icon name="layers" size={12} color="var(--qw-iris)" />
          <span>Effective request</span>
          {req.representative?.strategy && (
            <span style={{ color: 'var(--qw-fg-faint)' }}>· {req.representative.strategy.replace(/-/g, ' ')}</span>
          )}
          {req.turns && req.turns.length > 0 && (
            <span style={{ color: 'var(--qw-fg-faint)' }}>
              · representative of {req.turns.length} turn{req.turns.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
      )}

      {/* budget — §9 lists the token budget as Context-pane substance (a slim
          inline indicator, not the v15-rail dashboard widget). */}
      {budget && budget.totalTokens > 0 && (
        <div>
          <div
            className="mb-1.5 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.08em]"
            style={{ color: 'var(--qw-fg-faint)' }}
          >
            <span>Budget</span>
            <span>
              {fmtTokens(budget.usedTokens)} / {fmtTokens(budget.totalTokens)}
              {counts['dropped-budget'] > 0 ? ` · ${counts['dropped-budget']} dropped to fit` : ''}
            </span>
          </div>
          <div
            className="h-2 overflow-hidden rounded-full"
            style={{ background: 'var(--qw-bg-muted)', boxShadow: 'inset 0 0 0 1px var(--qw-border)' }}
          >
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(100, (budget.usedTokens / budget.totalTokens) * 100)}%`,
                background: budget.usedTokens > budget.totalTokens ? 'var(--qw-danger)' : 'var(--qw-crux)',
              }}
            />
          </div>
        </div>
      )}

      {/* composition bar */}
      {active.length > 0 && (
        <div className="flex flex-col gap-2">
          <div
            className="flex h-[26px] overflow-hidden rounded-[8px]"
            style={{ boxShadow: 'inset 0 0 0 1px var(--qw-border)' }}
          >
            {active.map((c, i) => {
              const w = ((c.sizeBytes ?? c.tokens ?? 0) / compBarTotal) * 100
              if (w <= 0) return null
              return (
                <div
                  key={c.id}
                  title={`${c.id} · ${fmtSize(c)}`}
                  style={{
                    width: `${w}%`,
                    background: COMP_TINTS[i % COMP_TINTS.length],
                    opacity: 0.85,
                    borderRight: '1px solid var(--qw-bg)',
                  }}
                />
              )
            })}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {active.map((c, i) => (
              <span
                key={c.id}
                className="inline-flex items-center gap-1.5 rounded-[6px] px-2 py-[3px] font-mono text-[10.5px]"
                style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}
              >
                <span className="size-2 rounded-[2px]" style={{ background: COMP_TINTS[i % COMP_TINTS.length] }} />
                {c.id}
                {c.priority != null && <span style={{ color: 'var(--qw-fg-faint)' }}>p{c.priority}</span>}
                {fmtSize(c) && <span style={{ color: 'var(--qw-fg-muted)' }}>{fmtSize(c)}</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      {mode === 'preview' ? (
        <Section
          title="Rendered request"
          right={
            <Chip tone="muted" mono>
              as assembled
            </Chip>
          }
        >
          <pre
            className="m-0 whitespace-pre-wrap rounded-[10px] px-4 py-3.5 font-mono text-[11px] leading-[1.7]"
            style={{
              background: 'var(--qw-bg-elev)',
              border: '1px solid var(--qw-border)',
              color: 'var(--qw-fg-muted)',
              overflowWrap: 'anywhere',
            }}
          >
            {buildPreview(baseContrib, active, messages)}
          </pre>
        </Section>
      ) : (
        <>
          {baseContrib && (
            <Section
              title="Base prompt"
              right={
                <Chip tone="muted" mono>
                  the single prompt — click to expand
                </Chip>
              }
            >
              <ContributionRow c={baseContrib} navigate={navigate} defaultOpen isBase />
            </Section>
          )}

          {injected.length > 0 && (
            <Section
              title="Injected contributions"
              right={
                <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
                  use[] · {injected.length} entries
                </span>
              }
            >
              <div className="flex flex-col gap-1.5">
                {injected.map((c) => (
                  <ContributionRow key={c.id} c={c} navigate={navigate} />
                ))}
              </div>
            </Section>
          )}

          {messages.messages.length > 0 && (
            <Section title="Accumulated context · messages">
              <div className="flex flex-col gap-1.5">
                {messages.messages.slice(0, 12).map((m, i) => {
                  const role = roleOf(m)
                  return (
                    <div
                      key={i}
                      className="flex gap-2.5 rounded-[8px] px-3 py-1.5"
                      style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}
                    >
                      <span
                        className="w-16 shrink-0 font-mono text-[9.5px] uppercase"
                        style={{ color: roleColor(role) }}
                      >
                        {role}
                      </span>
                      <span className="flex-1 truncate text-[11.5px]" style={{ color: 'var(--qw-fg-muted)' }}>
                        {textOf(m)}
                      </span>
                    </div>
                  )
                })}
              </div>
            </Section>
          )}

          {tools.length > 0 && (
            <Section
              title="Tools in the request"
              right={(() => {
                // Derive both counts from the rendered `tools` list, not `toolSource.size`:
                // the fallback toolSource map can hold names absent from `tools`, which would
                // otherwise drive the base count negative.
                const injectedCount = tools.filter((tl) => toolSource.has(tl.name)).length
                return (
                  <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
                    {tools.length - injectedCount} base + {injectedCount} injected
                  </span>
                )
              })()}
            >
              {/* v15 `Tools in the request` — flat chips, `← source` from the injecting
                  contribution, unused (not called this turn) dimmed. */}
              <div className="flex flex-wrap gap-[7px]">
                {tools.map((tl) => {
                  const src = toolSource.get(tl.name)
                  return (
                    <button
                      key={tl.name}
                      type="button"
                      title={tl.used ? 'called this turn' : 'available · not called this turn'}
                      onClick={() => navigate({ view: 'library-index', toolName: tl.name })}
                      className="inline-flex items-center gap-[5px] rounded-[8px] px-[9px] py-1 font-mono text-[11px] hover:underline"
                      style={{
                        background: 'var(--qw-bg-elev)',
                        border: '1px solid var(--qw-border)',
                        color: 'var(--qw-crux)',
                        opacity: tl.used ? 1 : 0.6,
                      }}
                    >
                      {tl.name}
                      {src && (
                        <span className="text-[8.5px]" style={{ color: INJ_COLOR[src.kind] ?? 'var(--qw-iris)' }}>
                          ← {injLabel(src.kind)}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </Section>
          )}
        </>
      )}
    </div>
  )
}

// ─── helpers ────────────────────────────────────────────────────────

function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="mt-1 flex items-center gap-2.5">
        <Eyebrow>{title}</Eyebrow>
        <div className="h-px flex-1" style={{ background: 'var(--qw-border)' }} />
        {right}
      </div>
      {children}
    </div>
  )
}

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s
}

function roleOf(m: unknown): string {
  if (m && typeof m === 'object' && typeof (m as { role?: unknown }).role === 'string')
    return (m as { role: string }).role
  if (m && typeof m === 'object' && typeof (m as { type?: unknown }).type === 'string')
    return (m as { type: string }).type
  return 'message'
}
function roleColor(role: string): string {
  return role === 'system'
    ? 'var(--qw-iris)'
    : role === 'assistant'
      ? 'var(--qw-crux)'
      : role === 'tool'
        ? 'var(--qw-fg-muted)'
        : 'var(--qw-ok)'
}
function textOf(m: unknown): string {
  if (m && typeof m === 'object') {
    const c = (m as { content?: unknown; text?: unknown }).content ?? (m as { text?: unknown }).text
    if (typeof c === 'string') return c
    if (c != null) {
      try {
        return JSON.stringify(c)
      } catch {
        return ''
      }
    }
  }
  return ''
}

function buildPreview(
  base: Contrib | undefined,
  active: Contrib[],
  messages: { messages: readonly unknown[]; system?: string; prompt?: string },
): string {
  const lines: string[] = ['<system>']
  if (base?.text) lines.push(base.text.trim())
  for (const c of active) {
    if (c.basePrompt) continue
    if (c.text) lines.push(`[${injLabel(c.kind)}:${c.id}] ${clip(c.text.replace(/\s+/g, ' ').trim(), 160)}`)
    else lines.push(`[${injLabel(c.kind)}:${c.id}] ${c.injects ?? ''}`)
  }
  lines.push('</system>', '')
  if (messages.prompt) lines.push('<user>', messages.prompt.trim())
  return lines.join('\n')
}
