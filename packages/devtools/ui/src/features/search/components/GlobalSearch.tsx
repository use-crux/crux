import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import {
  Activity,
  AlertTriangle,
  BookOpen,
  FlaskConical,
  Layers,
  Link2,
  Puzzle,
  Search,
  Shield,
  Sparkles,
  SquareStack,
} from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { useNavigation, type NavState } from '@/app/navigation/useNavigation'
import { useObservabilityRuns } from '@/features/observability/hooks/useObservabilityGraph'
import { useQualityInsights, useQualityExperiments } from '@/shared/hooks/useQualityApi'
import { useIndex } from '@/features/index/hooks/useIndex'
import { useJudgeEvents } from '@/app/runtime/runtimeStore'
import type {
  ContextMeta,
  JudgeEventData,
  ObservabilityRunSummary,
  PromptMeta,
  QualityInsightRecord,
  QualityExperimentSummary,
} from '@/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GlobalSearchProps {
  /** Controlled open state — pass from useGlobalSearchShortcut if wiring "/" shortcut from parent. */
  isOpen?: boolean
  /** Controlled setter — pass from useGlobalSearchShortcut if wiring "/" shortcut from parent. */
  setIsOpen?: (open: boolean) => void
  /** Hide the inline trigger button — the QW shell has its own sidebar search button. */
  hideTrigger?: boolean
}

type ResultCategory = 'traces' | 'prompts' | 'contexts' | 'judges' | 'insights' | 'experiments'

interface SearchResult {
  category: ResultCategory
  id: string
  label: string
  meta: string
  nav: NavState
}

const MAX_PER_CATEGORY = 5

const CATEGORY_CONFIG: Record<ResultCategory, { label: string; icon: typeof Search }> = {
  traces: { label: 'Traces', icon: Activity },
  prompts: { label: 'Prompts', icon: BookOpen },
  contexts: { label: 'Contexts', icon: Puzzle },
  judges: { label: 'Judges', icon: Shield },
  insights: { label: 'Insights', icon: Sparkles },
  experiments: { label: 'Experiments', icon: FlaskConical },
}

function matches(query: string, ...fields: (string | undefined | null)[]): boolean {
  const q = query.toLowerCase()
  return fields.some((f) => f != null && f.toLowerCase().includes(q))
}

function searchRuns(runs: ObservabilityRunSummary[], query: string): SearchResult[] {
  const results: SearchResult[] = []
  for (const run of runs) {
    if (results.length >= MAX_PER_CATEGORY) break
    if (matches(query, run.runId, run.traceId, run.promptId, run.model, run.name, run.rootPrimitive)) {
      results.push({
        category: 'traces',
        id: run.runId,
        label: run.promptId || run.name || run.runId.slice(0, 12),
        meta: `${run.model || run.rootPrimitive} · ${run.status}`,
        nav: { view: 'run-detail', traceId: run.runId },
      })
    }
  }
  return results
}

function searchPrompts(prompts: PromptMeta[], query: string): SearchResult[] {
  const results: SearchResult[] = []
  for (const p of prompts) {
    if (results.length >= MAX_PER_CATEGORY) break
    if (matches(query, p.id, p.description) || p.tags.some((tag) => matches(query, tag))) {
      results.push({
        category: 'prompts',
        id: p.id ?? 'unknown',
        label: p.id ?? 'Unnamed prompt',
        meta: p.description ?? (p.tags.join(', ') || 'No description'),
        nav: { view: 'library-index', promptId: p.id },
      })
    }
  }
  return results
}

function searchContexts(contexts: ContextMeta[], query: string): SearchResult[] {
  const results: SearchResult[] = []
  for (const c of contexts) {
    if (results.length >= MAX_PER_CATEGORY) break
    if (matches(query, c.id, c.description)) {
      results.push({
        category: 'contexts',
        id: c.id ?? 'unknown',
        label: c.id ?? 'Unnamed context',
        meta: c.description ?? (c.isStatic ? 'Static' : 'Dynamic'),
        nav: { view: 'library-index', contextId: c.id },
      })
    }
  }
  return results
}

function searchInsights(insights: readonly QualityInsightRecord[], query: string): SearchResult[] {
  const results: SearchResult[] = []
  for (const i of insights) {
    if (results.length >= MAX_PER_CATEGORY) break
    if (matches(query, i.insightId, i.title, i.summary, ...(i.tags ?? []))) {
      results.push({
        category: 'insights',
        id: i.insightId,
        label: i.title,
        meta: `${i.severity} · ${i.summary.slice(0, 80)}${i.summary.length > 80 ? '…' : ''}`,
        nav: { view: 'insights', insightId: i.insightId },
      })
    }
  }
  return results
}

function searchExperiments(experiments: readonly QualityExperimentSummary[], query: string): SearchResult[] {
  const results: SearchResult[] = []
  for (const e of experiments) {
    if (results.length >= MAX_PER_CATEGORY) break
    if (matches(query, e.experimentId, e.evaluationId, e.replayMode)) {
      const denom = e.cells - e.cellsSkipped
      const passRate = denom > 0 ? Math.round((e.cellsPassed / denom) * 100) : null
      results.push({
        category: 'experiments',
        id: e.experimentId,
        label: e.evaluationId,
        meta: `${e.passed ? 'passed' : 'failed'}${passRate != null ? ` · ${passRate}% pass` : ''} · replay ${e.replayMode}`,
        nav: { view: 'experiment-detail', experimentId: e.experimentId },
      })
    }
  }
  return results
}

function searchJudgeEvents(events: JudgeEventData[], query: string): SearchResult[] {
  const results: SearchResult[] = []
  const seen = new Set<string>()
  for (const j of events) {
    if (results.length >= MAX_PER_CATEGORY) break
    if (matches(query, j.metricId, j.traceId)) {
      const key = `${j.metricId}-${j.traceId ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      results.push({
        category: 'judges',
        id: key,
        label: j.metricId,
        meta: `Score: ${j.score}${j.traceId ? ` · ${j.traceId.slice(0, 12)}` : ''}`,
        nav: { view: 'insights' },
      })
    }
  }
  return results
}

// ---------------------------------------------------------------------------
// Context-aware actions (the "Actions" group, design `dx-workbench` `cmdk`)
// ---------------------------------------------------------------------------

/** A context-aware command — an accelerator for the screen you're on. Every
 *  action is also reachable by pointer in the UI; the palette never owns the
 *  only path to it. */
interface PaletteAction {
  id: string
  label: string
  hint?: string
  icon: ReactNode
  run: () => void
}

// The four lenses, kept local so `search` doesn't depend on the `run-detail`
// feature (structurally identical to its `RunLens`, so nav stays type-safe).
const LENS_IDS = ['tree', 'timeline', 'graph', 'story'] as const
type LensId = (typeof LENS_IDS)[number]
const LENS_LABEL: Record<LensId, string> = { tree: 'Tree', timeline: 'Timeline', graph: 'Graph', story: 'Story' }
const LENS_HINT: Record<LensId, string> = { tree: '1', timeline: '2', graph: '3', story: '4' }

// Render + keyboard order for result groups — must match `results`' build order.
const RENDER_ORDER: ResultCategory[] = ['traces', 'experiments', 'insights', 'prompts', 'contexts', 'judges']

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GlobalSearch({
  isOpen: controlledIsOpen,
  setIsOpen: controlledSetIsOpen,
  hideTrigger = false,
}: GlobalSearchProps) {
  // Source the search corpus directly — App.tsx used to prop-drill
  // these and was the only reason it needed `useIndex()`. Pulling
  // them locally means App.tsx is purely a gate, and re-renders of
  // unrelated state (judge events arriving over WS, index WS
  // pushes) don't propagate through the root.
  const { data: index } = useIndex()
  const prompts = index?.prompts ?? []
  const contexts = index?.contexts ?? []
  const judgeEvents = useJudgeEvents()
  const [internalIsOpen, internalSetIsOpen] = useState(false)
  const isOpen = controlledIsOpen ?? internalIsOpen
  const setIsOpen = controlledSetIsOpen ?? internalSetIsOpen
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const { navigate, nav } = useNavigation()
  const { runs } = useObservabilityRuns()
  const { data: insightsData } = useQualityInsights()
  const { data: experimentsData } = useQualityExperiments()
  const insights = insightsData ?? []
  const experiments = experimentsData ?? []

  const open = useCallback(() => {
    setIsOpen(true)
    setQuery('')
    setSelectedIndex(0)
  }, [setIsOpen])

  const close = useCallback(() => {
    setIsOpen(false)
    setQuery('')
    setSelectedIndex(0)
  }, [setIsOpen])

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      // Small delay to ensure the dialog is rendered
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [isOpen])

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen, close])

  // Compute results
  const results = useMemo(() => {
    if (query.length < 2) return []
    return [
      ...searchRuns(runs, query),
      ...searchExperiments(experiments, query),
      ...searchInsights(insights, query),
      ...searchPrompts(prompts, query),
      ...searchContexts(contexts, query),
      ...searchJudgeEvents(judgeEvents, query),
    ]
  }, [query, runs, experiments, insights, prompts, contexts, judgeEvents])

  // Group results by category for rendering
  const grouped = useMemo(() => {
    const groups: Partial<Record<ResultCategory, SearchResult[]>> = {}
    for (const r of results) {
      ;(groups[r.category] ??= []).push(r)
    }
    return groups
  }, [results])

  const selectResult = useCallback(
    (result: SearchResult) => {
      navigate(result.nav)
      close()
    },
    [navigate, close],
  )

  // Context-aware Actions group — the accelerators for the screen you're on.
  // `Next failure` / `Copy permalink` dispatch events the run-detail screen
  // owns, so the palette never reaches into run internals.
  const runNav = nav.view === 'run-detail' ? nav : null
  const actions = useMemo<PaletteAction[]>(() => {
    if (!runNav) return []
    const { traceId, spanId } = runNav
    const lens: LensId = runNav.lens ?? 'tree'
    const out: PaletteAction[] = [
      {
        id: 'next-failure',
        label: 'Next failure',
        hint: 'e',
        icon: <AlertTriangle className="h-3.5 w-3.5 text-(--qw-fg-muted)" />,
        run: () => window.dispatchEvent(new CustomEvent('qw:next-failure')),
      },
      {
        id: 'permalink',
        label: 'Copy permalink to selection',
        hint: '⌘⇧C',
        icon: <Link2 className="h-3.5 w-3.5 text-(--qw-fg-muted)" />,
        run: () => window.dispatchEvent(new CustomEvent('qw:copy-permalink')),
      },
    ]
    for (const l of LENS_IDS) {
      if (l === lens) continue
      out.push({
        id: `lens-${l}`,
        label: `Switch to ${LENS_LABEL[l]} lens`,
        hint: LENS_HINT[l],
        icon: <SquareStack className="h-3.5 w-3.5 text-(--qw-fg-muted)" />,
        run: () => navigate({ view: 'run-detail', traceId, lens: l, spanId }),
      })
    }
    return out
  }, [runNav, navigate])

  // Results flattened in render order (Actions → categories → payload row) so
  // the keyboard index agrees with the rendered rows.
  const orderedResults = useMemo(() => {
    const out: SearchResult[] = []
    for (const c of RENDER_ORDER) for (const r of grouped[c] ?? []) out.push(r)
    return out
  }, [grouped])

  const trimmed = query.trim()
  // Full-text payload search is an explicit, escalated final row — the
  // expensive query, never fired per keystroke (RUN-DETAIL-SPEC §7).
  const showPayload = trimmed.length >= 2
  const runPayload = useCallback(() => {
    navigate({ view: 'runs', search: trimmed })
    close()
  }, [navigate, trimmed, close])

  // One flat, ordered activation list spanning Actions + results + payload.
  const entries = useMemo<(() => void)[]>(() => {
    const list: (() => void)[] = []
    for (const a of actions)
      list.push(() => {
        a.run()
        close()
      })
    for (const r of orderedResults) list.push(() => selectResult(r))
    if (showPayload) list.push(runPayload)
    return list
  }, [actions, orderedResults, showPayload, selectResult, runPayload, close])

  // Clamp selected index when the entry list changes
  useEffect(() => {
    setSelectedIndex((prev) => (entries.length === 0 ? 0 : Math.min(prev, entries.length - 1)))
  }, [entries.length])

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return
    const selected = listRef.current.querySelector('[data-selected="true"]')
    selected?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  const onInputKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex((prev) => (prev < entries.length - 1 ? prev + 1 : prev))
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev))
          break
        case 'Enter':
          e.preventDefault()
          entries[selectedIndex]?.()
          break
      }
    },
    [entries, selectedIndex],
  )

  // Track flat index for keyboard navigation — Actions first, then result
  // groups (in RENDER_ORDER), then the payload row.
  let flatIndex = -1

  return (
    <>
      {/* Trigger button */}
      {!hideTrigger && (
        <button
          onClick={open}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-(--qw-fg-muted)',
            'hover:bg-(--qw-bg-muted) hover:text-(--qw-fg) transition-colors',
          )}
          title="Search (press /)"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Search</span>
          <kbd className="ml-1 hidden sm:inline rounded bg-(--qw-bg-muted) px-1 py-0.5 text-[10px] font-mono text-(--qw-fg-faint)">
            /
          </kbd>
        </button>
      )}

      {/* Backdrop + Dialog */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" onClick={close}>
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60" />

          {/* Dialog */}
          <div
            className={cn(
              'relative w-full max-w-lg rounded-lg border border-(--qw-border-strong)/80',
              'bg-(--qw-bg-elev) shadow-2xl overflow-hidden',
            )}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Search input */}
            <div className="flex items-center gap-2 border-b border-(--qw-border) px-3 py-2.5">
              <Search className="h-4 w-4 text-(--qw-fg-faint) shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setSelectedIndex(0)
                }}
                onKeyDown={onInputKeyDown}
                placeholder="Search traces, experiments, insights, prompts, contexts…"
                className={cn(
                  'flex-1 bg-transparent text-sm text-(--qw-fg) outline-none',
                  'placeholder:text-(--qw-fg-faint)',
                )}
              />
              <kbd className="rounded bg-(--qw-bg-muted) px-1.5 py-0.5 text-[10px] font-mono text-(--qw-fg-faint)">
                ESC
              </kbd>
            </div>

            {/* Results */}
            <div ref={listRef} className="max-h-[60vh] overflow-y-auto py-1">
              {/* Actions · context-aware accelerators for the current screen */}
              {actions.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 px-3 pt-2 pb-1">
                    <Layers className="h-3 w-3 text-(--qw-fg-faint)" />
                    <span className="text-[11px] font-medium uppercase tracking-wider text-(--qw-fg-faint)">
                      Actions · this run
                    </span>
                  </div>
                  {actions.map((action) => {
                    flatIndex++
                    const idx = flatIndex
                    const isSelected = idx === selectedIndex
                    return (
                      <button
                        key={action.id}
                        data-selected={isSelected}
                        onClick={() => {
                          action.run()
                          close()
                        }}
                        onMouseEnter={() => setSelectedIndex(idx)}
                        className={cn(
                          'flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors',
                          isSelected
                            ? 'bg-(--qw-bg-muted) text-(--qw-fg)'
                            : 'text-(--qw-fg-muted) hover:bg-(--qw-bg-muted)/50',
                        )}
                      >
                        {action.icon}
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{action.label}</span>
                        {action.hint && (
                          <kbd className="rounded bg-(--qw-bg-muted) px-1 py-0.5 font-mono text-[10px] text-(--qw-fg-faint)">
                            {action.hint}
                          </kbd>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}

              {actions.length === 0 && query.length >= 2 && results.length === 0 && (
                <div className="px-3 py-8 text-center text-sm text-(--qw-fg-faint)">No results found</div>
              )}

              {actions.length === 0 && query.length > 0 && query.length < 2 && (
                <div className="px-3 py-8 text-center text-sm text-(--qw-fg-faint)">
                  Type at least 2 characters to search
                </div>
              )}

              {RENDER_ORDER.map((category) => {
                const items = grouped[category]
                if (!items || items.length === 0) return null
                const config = CATEGORY_CONFIG[category]
                const Icon = config.icon

                return (
                  <div key={category}>
                    <div className="flex items-center gap-1.5 px-3 pt-2 pb-1">
                      <Icon className="h-3 w-3 text-(--qw-fg-faint)" />
                      <span className="text-[11px] font-medium text-(--qw-fg-faint) uppercase tracking-wider">
                        {config.label}
                      </span>
                    </div>
                    {items.map((result) => {
                      flatIndex++
                      const idx = flatIndex
                      const isSelected = idx === selectedIndex

                      return (
                        <button
                          key={result.id}
                          data-selected={isSelected}
                          onClick={() => selectResult(result)}
                          onMouseEnter={() => setSelectedIndex(idx)}
                          className={cn(
                            'flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors',
                            isSelected
                              ? 'bg-(--qw-bg-muted) text-(--qw-fg)'
                              : 'text-(--qw-fg-muted) hover:bg-(--qw-bg-muted)/50',
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">{result.label}</div>
                            <div className="truncate text-xs text-(--qw-fg-faint)">{result.meta}</div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )
              })}

              {/* Full-text payload search — escalated, never per-keystroke. */}
              {showPayload &&
                (() => {
                  flatIndex++
                  const idx = flatIndex
                  const isSelected = idx === selectedIndex
                  return (
                    <>
                      <div className="mx-3 my-1 border-t border-(--qw-border)" />
                      <button
                        data-selected={isSelected}
                        onClick={runPayload}
                        onMouseEnter={() => setSelectedIndex(idx)}
                        className={cn(
                          'flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors',
                          isSelected
                            ? 'bg-(--qw-bg-muted) text-(--qw-fg)'
                            : 'text-(--qw-fg-muted) hover:bg-(--qw-bg-muted)/50',
                        )}
                      >
                        <Search className="h-3.5 w-3.5 shrink-0 text-(--qw-fg-faint)" />
                        <span className="min-w-0 flex-1 truncate text-sm">
                          Search inside trace payloads for “<span className="text-(--qw-fg)">{trimmed}</span>”
                        </span>
                        <kbd className="rounded bg-(--qw-bg-muted) px-1 py-0.5 font-mono text-[10px] text-(--qw-fg-faint)">
                          &crarr;
                        </kbd>
                      </button>
                    </>
                  )
                })()}
            </div>

            {/* Footer hint */}
            {entries.length > 0 && (
              <div className="flex items-center gap-3 border-t border-(--qw-border) px-3 py-1.5 text-[10px] text-(--qw-fg-faint)">
                <span>
                  <kbd className="rounded bg-(--qw-bg-muted) px-1 py-0.5 font-mono">&uarr;&darr;</kbd> Navigate
                </span>
                <span>
                  <kbd className="rounded bg-(--qw-bg-muted) px-1 py-0.5 font-mono">&crarr;</kbd> Open
                </span>
                <span>
                  <kbd className="rounded bg-(--qw-bg-muted) px-1 py-0.5 font-mono">esc</kbd> Close
                </span>
                <span className="ml-auto hidden sm:inline">everything here is also reachable by pointer</span>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
