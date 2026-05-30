import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Activity, BookOpen, FlaskConical, Layers, Puzzle, Search, Shield, Sparkles } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { useNavigation, type NavState } from '@/app/navigation/useNavigation'
import { useObservabilityRuns } from '@/features/observability/hooks/useObservabilityGraph'
import {
  useQualitySuites,
  useQualityInsights,
  useQualityExperiments,
} from '@/shared/hooks/useQualityApi'
import { useCatalog } from '@/features/catalog/hooks/useCatalog'
import { useJudgeEvents } from '@/app/runtime/runtimeStore'
import type {
  ContextMeta,
  JudgeEventData,
  ObservabilityRunSummary,
  PromptMeta,
  QualitySuiteRecord,
  QualityInsightRecord,
  QualityExperimentRecord,
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

type ResultCategory =
  | 'traces'
  | 'prompts'
  | 'contexts'
  | 'judges'
  | 'suites'
  | 'insights'
  | 'experiments'

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
  suites: { label: 'Suites', icon: Layers },
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
        nav: { view: 'library-catalog', promptId: p.id },
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
        nav: { view: 'library-catalog', contextId: c.id },
      })
    }
  }
  return results
}

function searchSuites(suites: readonly QualitySuiteRecord[], query: string): SearchResult[] {
  const results: SearchResult[] = []
  for (const s of suites) {
    if (results.length >= MAX_PER_CATEGORY) break
    if (matches(query, s.suiteId, s.name, ...(s.tags ?? []))) {
      results.push({
        category: 'suites',
        id: s.suiteId,
        label: s.name ?? s.suiteId,
        meta: `${s.caseCount} case${s.caseCount === 1 ? '' : 's'}${s.scorers?.length ? ` · ${s.scorers.length} scorer${s.scorers.length === 1 ? '' : 's'}` : ''}`,
        nav: { view: 'dataset-detail', suiteId: s.suiteId },
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

function searchExperiments(
  experiments: readonly QualityExperimentRecord[],
  query: string,
): SearchResult[] {
  const results: SearchResult[] = []
  for (const e of experiments) {
    if (results.length >= MAX_PER_CATEGORY) break
    if (matches(query, e.id, e.suite.id, e.suite.name, e.status)) {
      const passRate =
        e.summary.total > 0 ? Math.round((e.summary.passed / e.summary.total) * 100) : null
      results.push({
        category: 'experiments',
        id: e.id,
        label: e.suite.name ?? e.suite.id,
        meta: `${e.id} · ${e.status}${passRate != null ? ` · ${passRate}% pass` : ''}`,
        nav: { view: 'experiment-detail', experimentId: e.id },
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
// Component
// ---------------------------------------------------------------------------

export function GlobalSearch({
  isOpen: controlledIsOpen,
  setIsOpen: controlledSetIsOpen,
  hideTrigger = false,
}: GlobalSearchProps) {
  // Source the search corpus directly — App.tsx used to prop-drill
  // these and was the only reason it needed `useCatalog()`. Pulling
  // them locally means App.tsx is purely a gate, and re-renders of
  // unrelated state (judge events arriving over WS, catalog WS
  // pushes) don't propagate through the root.
  const { data: catalog } = useCatalog()
  const prompts = catalog?.prompts ?? []
  const contexts = catalog?.contexts ?? []
  const judgeEvents = useJudgeEvents()
  const [internalIsOpen, internalSetIsOpen] = useState(false)
  const isOpen = controlledIsOpen ?? internalIsOpen
  const setIsOpen = controlledSetIsOpen ?? internalSetIsOpen
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const { navigate } = useNavigation()
  const { runs } = useObservabilityRuns()
  const { data: suitesData } = useQualitySuites()
  const { data: insightsData } = useQualityInsights()
  const { data: experimentsData } = useQualityExperiments()
  const suites = suitesData ?? []
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
      ...searchSuites(suites, query),
      ...searchExperiments(experiments, query),
      ...searchInsights(insights, query),
      ...searchPrompts(prompts, query),
      ...searchContexts(contexts, query),
      ...searchJudgeEvents(judgeEvents, query),
    ]
  }, [query, runs, suites, experiments, insights, prompts, contexts, judgeEvents])

  // Clamp selected index when results change
  useEffect(() => {
    setSelectedIndex((prev) => (results.length === 0 ? 0 : Math.min(prev, results.length - 1)))
  }, [results.length])

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return
    const selected = listRef.current.querySelector('[data-selected="true"]')
    selected?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  const selectResult = useCallback(
    (result: SearchResult) => {
      navigate(result.nav)
      close()
    },
    [navigate, close],
  )

  const onInputKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex((prev) => (prev < results.length - 1 ? prev + 1 : prev))
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev))
          break
        case 'Enter':
          e.preventDefault()
          if (results[selectedIndex]) {
            selectResult(results[selectedIndex])
          }
          break
      }
    },
    [results, selectedIndex, selectResult],
  )

  // Group results by category for rendering
  const grouped = useMemo(() => {
    const groups: Partial<Record<ResultCategory, SearchResult[]>> = {}
    for (const r of results) {
      ;(groups[r.category] ??= []).push(r)
    }
    return groups
  }, [results])

  // Track flat index for keyboard navigation
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
                placeholder="Search traces, suites, experiments, insights, prompts, contexts…"
                className={cn('flex-1 bg-transparent text-sm text-(--qw-fg) outline-none', 'placeholder:text-(--qw-fg-faint)')}
              />
              <kbd className="rounded bg-(--qw-bg-muted) px-1.5 py-0.5 text-[10px] font-mono text-(--qw-fg-faint)">ESC</kbd>
            </div>

            {/* Results */}
            <div ref={listRef} className="max-h-[60vh] overflow-y-auto py-1">
              {query.length >= 2 && results.length === 0 && (
                <div className="px-3 py-8 text-center text-sm text-(--qw-fg-faint)">No results found</div>
              )}

              {query.length > 0 && query.length < 2 && (
                <div className="px-3 py-8 text-center text-sm text-(--qw-fg-faint)">Type at least 2 characters to search</div>
              )}

              {(['traces', 'suites', 'experiments', 'insights', 'prompts', 'contexts', 'judges'] as ResultCategory[]).map((category) => {
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
                            isSelected ? 'bg-(--qw-bg-muted) text-(--qw-fg)' : 'text-(--qw-fg-muted) hover:bg-(--qw-bg-muted)/50',
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
            </div>

            {/* Footer hint */}
            {results.length > 0 && (
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
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
