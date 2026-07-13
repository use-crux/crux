/**
 * Quality Workbench navigation.
 *
 * URL-backed view state. Two screen kinds:
 *  - list-style screens (overview, runs, experiments, …) — identified by a
 *    `view` discriminator.
 *  - detail screens that take an entity id (run, experiment, …).
 */

import {
  createContext,
  createElement,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from 'react'
import { flushSync } from 'react-dom'
import type { RunLens } from '@/features/run-detail/types'

/** Depth-based direction inference for view transitions.
 *
 *  Counts the `/`-delimited path segments. More segments = deeper.
 *  Equal depth = lateral nav (no direction). This is a heuristic, not
 *  exact — it correctly handles the common case (list → detail and
 *  back) without needing a hand-curated route hierarchy. */
function inferNavDirection(fromPath: string, toPath: string): 'forward' | 'back' | null {
  const a = fromPath.split('/').filter(Boolean).length
  const b = toPath.split('/').filter(Boolean).length
  if (b > a) return 'forward'
  if (b < a) return 'back'
  return null
}

interface DocumentWithViewTransition {
  startViewTransition?: (cb: () => void | Promise<void>) => {
    finished: Promise<void>
  }
}

/** Run `update` inside a browser view transition when available.
 *  Falls back to running `update` synchronously on browsers without
 *  the View Transitions API. Honors prefers-reduced-motion via the
 *  CSS recipe (see index.css) — we still run the transition, but the
 *  CSS disables the animation. */
function runViewTransition(direction: 'forward' | 'back' | null, update: () => void): void {
  const doc = document as Document & DocumentWithViewTransition
  if (typeof doc.startViewTransition !== 'function') {
    update()
    return
  }
  if (direction) {
    document.documentElement.dataset.navDirection = direction
  } else {
    delete document.documentElement.dataset.navDirection
  }
  const transition = doc.startViewTransition(() => {
    // `flushSync` is required: the VT snapshot of the "new" state only
    // captures DOM changes that have already committed when the
    // callback resolves. Without it, useTransition would defer the
    // setState past the snapshot point and the transition would
    // animate the OLD content to ITSELF.
    flushSync(() => update())
  })
  transition.finished.finally(() => {
    delete document.documentElement.dataset.navDirection
  })
}

export type NavState =
  // Quality screens
  | { view: 'overview' }
  | {
      view: 'insights'
      insightId?: string
      severity?: readonly ('high' | 'medium' | 'low')[]
      target?: readonly string[]
      status?: readonly ('open' | 'dismissed' | 'resolved')[]
      /** Insight title (e.g. "Run is slow") — server stamps these consistently. */
      title?: readonly string[]
      /** Insight tag (e.g. "Latency", "Cost"). */
      tag?: readonly string[]
      groupBy?: 'none' | 'severity' | 'target' | 'status' | 'title' | 'tag'
      search?: string
    }
  | {
      view: 'runs'
      groupBy?: 'none' | 'primitive' | 'session' | 'target'
      status?: readonly string[]
      target?: readonly string[]
      model?: readonly string[]
      last?: 'all' | '1h' | '24h' | '7d' | '30d'
      has?: 'feedback' | 'experiment'
      search?: string
      /** Pre-filter to runs whose DefinitionRefs include this Catalog definition (Phase 3 filter). */
      definitionId?: string
    }
  | { view: 'runtime' }
  | { view: 'run-detail'; traceId: string; lens?: RunLens; spanId?: string; summary?: boolean }
  | { view: 'evaluations' }
  | { view: 'experiments' }
  | { view: 'experiment-detail'; experimentId: string }
  | { view: 'baselines' }
  | { view: 'feedback'; feedbackId?: string }
  | { view: 'cassettes'; path?: string }
  | { view: 'scorers' }
  // Library group (legacy inspect screens)
  | { view: 'library-index'; promptId?: string; contextId?: string; toolName?: string; tab?: string }
  | { view: 'library-memory'; memoryId?: string }
  | { view: 'library-workspaces'; workspaceId?: string; filePath?: string }
  | { view: 'library-plans'; planId?: string }
  // ── Legacy view aliases. Kept so orphan view files in `views/` keep
  // ── type-checking after the redesign. They are not mounted by the
  // ── new App shell; if hit, callers are coerced to a safe target.
  | { view: 'traces'; traceId?: string; sessionFilter?: string; flowFilter?: string }
  | { view: 'detail'; traceId?: string; sessionId?: string; flowId?: string }
  | { view: 'prompts'; promptId?: string; contextId?: string; toolName?: string; tab?: string }
  | { view: 'memory'; memoryId?: string }
  | { view: 'workspaces' }
  | { view: 'sessions'; sessionId?: string }
  | { view: 'security' }
  | { view: 'constraints' }
  | { view: 'plans' }
  | { view: 'dashboard' }
  | { view: 'evals'; tab?: 'quality' | 'prompts' | 'rag' | 'flows' | 'judges'; expandedId?: string }

// ─── Path encoding ──────────────────────────────────────────────────

export function pathFromState(state: NavState): string {
  switch (state.view) {
    case 'overview':
      return '/'
    case 'insights': {
      if (state.insightId) return `/insights/${encodeURIComponent(state.insightId)}`
      const params = new URLSearchParams()
      if (state.severity && state.severity.length > 0) params.set('sev', state.severity.join(','))
      if (state.target && state.target.length > 0) params.set('target', state.target.join(','))
      if (state.status && state.status.length > 0) params.set('status', state.status.join(','))
      if (state.title && state.title.length > 0) params.set('title', state.title.join('|'))
      if (state.tag && state.tag.length > 0) params.set('tag', state.tag.join(','))
      if (state.groupBy && state.groupBy !== 'none') params.set('group', state.groupBy)
      if (state.search) params.set('q', state.search)
      const qs = params.toString()
      return `/insights${qs ? `?${qs}` : ''}`
    }
    case 'runs': {
      const params = new URLSearchParams()
      if (state.groupBy && state.groupBy !== 'none') params.set('group', state.groupBy)
      if (state.status && state.status.length > 0) params.set('status', state.status.join(','))
      if (state.target && state.target.length > 0) params.set('target', state.target.join(','))
      if (state.model && state.model.length > 0) params.set('model', state.model.join(','))
      if (state.last && state.last !== 'all') params.set('last', state.last)
      if (state.has) params.set('has', state.has)
      if (state.search) params.set('q', state.search)
      if (state.definitionId) params.set('definitionId', state.definitionId)
      const qs = params.toString()
      return `/runs${qs ? `?${qs}` : ''}`
    }
    case 'runtime':
      return '/runtime'
    case 'run-detail': {
      const params: string[] = []
      // `tree` is the default lens — omitted from the URL to keep links clean.
      if (state.lens && state.lens !== 'tree') params.push(`lens=${state.lens}`)
      if (state.summary) params.push('summary=1')
      if (state.spanId) params.push(`spanId=${encodeURIComponent(state.spanId)}`)
      const qs = params.length > 0 ? `?${params.join('&')}` : ''
      return `/runs/${encodeURIComponent(state.traceId)}${qs}`
    }
    case 'evaluations':
      return '/evaluations'
    case 'experiments':
      return '/experiments'
    case 'experiment-detail':
      return `/experiments/${encodeURIComponent(state.experimentId)}`
    case 'baselines':
      return '/baselines'
    case 'feedback':
      return state.feedbackId ? `/feedback/${encodeURIComponent(state.feedbackId)}` : '/feedback'
    case 'cassettes':
      return state.path ? `/cassettes/${encodeURIComponent(state.path)}` : '/cassettes'
    case 'scorers':
      return '/scorers'
    case 'library-index': {
      // Reserved tab keyword for the sweep view (index-wide lint health).
      if (state.tab === 'health' && !state.promptId && !state.contextId && !state.toolName) {
        return '/library/index/health'
      }
      if (state.toolName) return `/library/index/tool/${encodeURIComponent(state.toolName)}`
      if (state.contextId)
        return `/library/index/context/${encodeURIComponent(state.contextId)}`
      if (state.promptId && state.tab)
        return `/library/index/${encodeURIComponent(state.promptId)}/${encodeURIComponent(state.tab)}`
      if (state.promptId) return `/library/index/${encodeURIComponent(state.promptId)}`
      return '/library/index'
    }
    case 'library-memory':
      return state.memoryId
        ? `/library/memory/${encodeURIComponent(state.memoryId)}`
        : '/library/memory'
    case 'library-workspaces': {
      if (state.workspaceId) {
        const fp = state.filePath ? `/${encodeURIComponent(state.filePath)}` : ''
        return `/library/workspaces/${encodeURIComponent(state.workspaceId)}${fp}`
      }
      return '/library/workspaces'
    }
    case 'library-plans':
      return state.planId
        ? `/library/plans/${encodeURIComponent(state.planId)}`
        : '/library/plans'
    // Legacy aliases → coerce to nearest new screen
    case 'traces':
      return state.traceId ? `/runs/${encodeURIComponent(state.traceId)}` : '/runs'
    case 'detail':
      return state.traceId ? `/runs/${encodeURIComponent(state.traceId)}` : '/runs'
    case 'prompts':
      return state.toolName
        ? `/library/index/tool/${encodeURIComponent(state.toolName)}`
        : state.promptId
          ? `/library/index/${encodeURIComponent(state.promptId)}`
          : '/library/index'
    case 'memory':
      return state.memoryId
        ? `/library/memory/${encodeURIComponent(state.memoryId)}`
        : '/library/memory'
    case 'workspaces':
      return '/library/workspaces'
    case 'sessions':
      return '/runs?group=session'
    case 'security':
      return '/insights'
    case 'constraints':
      return '/runs'
    case 'plans':
      return '/library/plans'
    case 'dashboard':
      return '/'
    case 'evals':
      return '/experiments'
  }
}

// ─── Path decoding ──────────────────────────────────────────────────

export function stateFromPath(path: string, search?: string): NavState {
  const params = new URLSearchParams(search ?? '')
  const cleaned = path === '/' ? '/' : path.replace(/\/+$/, '')
  const segments = cleaned.split('/').filter(Boolean)

  if (segments.length === 0) return { view: 'overview' }

  const [root, a, b, c] = segments

  switch (root) {
    case 'insights': {
      if (a) return { view: 'insights', insightId: decodeURIComponent(a) }
      const sev = params.get('sev')
      const target = params.get('target')
      const status = params.get('status')
      const title = params.get('title')
      const tag = params.get('tag')
      const group = params.get('group')
      const groupBy: 'none' | 'severity' | 'target' | 'status' | 'title' | 'tag' =
        group === 'severity' ||
        group === 'target' ||
        group === 'status' ||
        group === 'title' ||
        group === 'tag'
          ? group
          : 'none'
      const search = params.get('q') ?? undefined
      const severityValid = (sev?.split(',').filter((s) => s === 'high' || s === 'medium' || s === 'low') ??
        []) as readonly ('high' | 'medium' | 'low')[]
      const statusValid = (status?.split(',').filter(
        (s) => s === 'open' || s === 'dismissed' || s === 'resolved',
      ) ?? []) as readonly ('open' | 'dismissed' | 'resolved')[]
      // Titles are pipe-separated since they can contain commas in e.g.
      // "Run has high token usage" plus future variants.
      const titleValid = title ? title.split('|').filter(Boolean) : []
      const tagValid = tag ? tag.split(',').filter(Boolean) : []
      return {
        view: 'insights',
        ...(severityValid.length > 0 ? { severity: severityValid } : {}),
        ...(target ? { target: target.split(',').filter(Boolean) } : {}),
        ...(statusValid.length > 0 ? { status: statusValid } : {}),
        ...(titleValid.length > 0 ? { title: titleValid } : {}),
        ...(tagValid.length > 0 ? { tag: tagValid } : {}),
        ...(groupBy !== 'none' ? { groupBy } : {}),
        ...(search ? { search } : {}),
      }
    }
    case 'runs': {
      if (a) {
        const l = params.get('lens')
        const validLenses: readonly RunLens[] = ['tree', 'timeline', 'graph', 'story']
        const lens = (validLenses as readonly string[]).includes(l ?? '')
          ? (l as RunLens)
          : 'tree'
        const spanId = params.get('spanId') ?? undefined
        const summary = params.get('summary') === '1'
        return {
          view: 'run-detail',
          traceId: decodeURIComponent(a),
          lens,
          ...(summary ? { summary: true } : {}),
          ...(spanId ? { spanId: decodeURIComponent(spanId) } : {}),
        }
      }
      const group = params.get('group')
      const groupBy =
        group === 'primitive' || group === 'session' || group === 'target' ? group : 'none'
      const status = params.get('status')
      const target = params.get('target')
      const model = params.get('model')
      const last = params.get('last')
      type LastValue = 'all' | '1h' | '24h' | '7d' | '30d'
      const lastValid: LastValue =
        last === '1h' || last === '24h' || last === '7d' || last === '30d' ? last : 'all'
      const has = params.get('has')
      const hasValid = has === 'feedback' || has === 'experiment' ? has : undefined
      const search = params.get('q') ?? undefined
      const definitionId = params.get('definitionId') ?? undefined
      return {
        view: 'runs',
        groupBy,
        ...(status ? { status: status.split(',').filter(Boolean) } : {}),
        ...(target ? { target: target.split(',').filter(Boolean) } : {}),
        ...(model ? { model: model.split(',').filter(Boolean) } : {}),
        ...(lastValid !== 'all' ? { last: lastValid } : {}),
        ...(hasValid ? { has: hasValid } : {}),
        ...(search ? { search } : {}),
        ...(definitionId ? { definitionId } : {}),
      }
    }
    case 'runtime':
      return { view: 'runtime' }
    case 'evaluations':
      return { view: 'evaluations' }
    case 'experiments':
      return a
        ? { view: 'experiment-detail', experimentId: decodeURIComponent(a) }
        : { view: 'experiments' }
    case 'baselines':
      return { view: 'baselines' }
    case 'feedback':
      return a ? { view: 'feedback', feedbackId: decodeURIComponent(a) } : { view: 'feedback' }
    case 'cassettes':
      return a ? { view: 'cassettes', path: decodeURIComponent(a) } : { view: 'cassettes' }
    case 'scorers':
      return { view: 'scorers' }
    case 'library': {
      const section = a
      // `library/index/...` is canonical; `library/prompts/...` kept
      // as a backward-compat alias so old bookmarks still resolve.
      if (section === 'index' || section === 'prompts') {
        if (b === 'health' && !c) return { view: 'library-index', tab: 'health' }
        if (b === 'tool' && c) return { view: 'library-index', toolName: decodeURIComponent(c) }
        if (b === 'context' && c)
          return { view: 'library-index', contextId: decodeURIComponent(c) }
        if (b) {
          const promptId = decodeURIComponent(b)
          if (c) return { view: 'library-index', promptId, tab: decodeURIComponent(c) }
          return { view: 'library-index', promptId }
        }
        return { view: 'library-index' }
      }
      if (section === 'memory') {
        return b ? { view: 'library-memory', memoryId: decodeURIComponent(b) } : { view: 'library-memory' }
      }
      if (section === 'workspaces') {
        if (b) {
          const workspaceId = decodeURIComponent(b)
          // path remainder beyond `/library/workspaces/{id}/...` is the file path
          const rest = segments.slice(3).map(decodeURIComponent).join('/')
          return rest
            ? { view: 'library-workspaces', workspaceId, filePath: rest }
            : { view: 'library-workspaces', workspaceId }
        }
        return { view: 'library-workspaces' }
      }
      if (section === 'plans') {
        return b
          ? { view: 'library-plans', planId: decodeURIComponent(b) }
          : { view: 'library-plans' }
      }
      return { view: 'overview' }
    }
    default:
      return { view: 'overview' }
  }
}

// ─── Context ────────────────────────────────────────────────────────

interface NavigationContextValue {
  nav: NavState
  navigate: (state: NavState) => void
  /** True while a navigation `setNav` is still pending in a transition.
   *  Use this to show a top progress bar / disable nav buttons without
   *  blanking the currently-rendered screen. */
  isNavigating: boolean
}

const NavigationContext = createContext<NavigationContextValue | null>(null)

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [nav, setNav] = useState<NavState>(() =>
    stateFromPath(window.location.pathname, window.location.search),
  )
  const [isNavigating, startNavigationTransition] = useTransition()

  const navigate = useCallback((state: NavState) => {
    const path = pathFromState(state)
    // Push the URL synchronously so back/forward semantics stay sane.
    const fromPath = window.location.pathname
    window.history.pushState(state, '', path)
    const direction = inferNavDirection(fromPath, path)
    // When the browser supports `document.startViewTransition`, drive
    // the route swap through it: the API snapshots the old DOM, runs
    // our update synchronously inside `flushSync`, snapshots the new
    // DOM, and animates between them. CSS recipes in index.css turn
    // this into a directional slide. On unsupported browsers we fall
    // back to React's `startTransition` so the previous screen stays
    // visible while the next one resolves.
    if (
      typeof (document as Document & DocumentWithViewTransition).startViewTransition === 'function'
    ) {
      runViewTransition(direction, () => setNav(state))
    } else {
      startNavigationTransition(() => {
        setNav(state)
      })
    }
  }, [])

  useEffect(() => {
    const onPopState = () => {
      const next = stateFromPath(window.location.pathname, window.location.search)
      // Browser back/forward — we don't know the previous path here
      // (history is already updated), so direction comes from comparing
      // `nav` vs the new state. For simplicity we always treat popstate
      // as a 'back' direction; the alternative (digging into history
      // state for a depth tag) isn't worth the complexity.
      const direction: 'back' = 'back'
      if (
        typeof (document as Document & DocumentWithViewTransition).startViewTransition ===
        'function'
      ) {
        runViewTransition(direction, () => setNav(next))
      } else {
        startTransition(() => {
          setNav(next)
        })
      }
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const value = useMemo<NavigationContextValue>(
    () => ({ nav, navigate, isNavigating }),
    [nav, navigate, isNavigating],
  )

  return createElement(NavigationContext.Provider, { value }, children)
}

export function useNavigation(): NavigationContextValue {
  const ctx = useContext(NavigationContext)
  if (!ctx) throw new Error('useNavigation must be used within a NavigationProvider')
  return ctx
}
