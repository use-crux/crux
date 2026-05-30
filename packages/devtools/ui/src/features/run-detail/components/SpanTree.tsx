import { useDeferredValue, useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { RowErrorBoundary } from '@/qw/shell/SectionBoundary'
import {
  ChevronRight,
  ChevronDown,
  Users,
  GitBranch,
  Layers,
  Bot,
  CheckCircle,
  Sparkles,
  Search,
  List,
  BarChart3,
  ArrowRightLeft,
  ArrowLeftRight,
  Network,
} from 'lucide-react'
import type { SpanNode } from '@/features/observability/lib/span-tree'

type ViewMode = 'tree' | 'timeline'

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatDuration(ms: number | undefined): string {
  if (ms == null) return ''
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const mins = Math.floor(ms / 60_000)
  const secs = Math.round((ms % 60_000) / 1000)
  return `${mins}m ${secs}s`
}

function formatCost(cost: number | undefined): string {
  if (cost == null) return ''
  if (cost < 0.01) return `$${cost.toFixed(4)}`
  if (cost < 1) return `$${cost.toFixed(2)}`
  return `$${cost.toFixed(2)}`
}

function formatTokens(tokens: number | undefined): string {
  if (tokens == null) return ''
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`
  return `${tokens}`
}

// ---------------------------------------------------------------------------
// Flatten tree into visible list respecting collapsed state
// ---------------------------------------------------------------------------

function flattenVisible(node: SpanNode, collapsed: Set<string>): SpanNode[] {
  const result: SpanNode[] = [node]
  if (!collapsed.has(node.id) && node.children.length > 0) {
    for (const child of node.children) {
      result.push(...flattenVisible(child, collapsed))
    }
  }
  return result
}

function collectAll(node: SpanNode): SpanNode[] {
  const result: SpanNode[] = [node]
  for (const child of node.children) {
    result.push(...collectAll(child))
  }
  return result
}

function filterTree(node: SpanNode, query: string): SpanNode | null {
  const lower = query.toLowerCase()
  const matchesSelf = node.label.toLowerCase().includes(lower)
  const filteredChildren: SpanNode[] = []
  for (const child of node.children) {
    const filtered = filterTree(child, query)
    if (filtered) filteredChildren.push(filtered)
  }
  if (matchesSelf || filteredChildren.length > 0) {
    return { ...node, children: filteredChildren }
  }
  return null
}

// ---------------------------------------------------------------------------
// Collapse redundant FLOW > STEP pairs that share label + metrics
//
// A flow with a single step child whose label and metrics mirror the flow
// exactly is just a wrapper — render the step's children directly under the
// flow rather than showing two visually identical rows.
// ---------------------------------------------------------------------------

function isRedundantStepChild(flow: SpanNode, step: SpanNode): boolean {
  if (flow.kind !== 'flow' || step.kind !== 'step') return false
  if (flow.label !== step.label) return false
  if ((flow.tokens ?? 0) !== (step.tokens ?? 0)) return false
  if ((flow.durationMs ?? 0) !== (step.durationMs ?? 0)) return false
  const flowCost = flow.cost ?? 0
  const stepCost = step.cost ?? 0
  return Math.abs(flowCost - stepCost) < 1e-6
}

function collapseRedundantSteps(node: SpanNode): SpanNode {
  const newChildren: SpanNode[] = []
  for (const child of node.children) {
    const collapsedChild = collapseRedundantSteps(child)
    if (node.kind === 'flow' && node.children.length === 1 && isRedundantStepChild(node, child)) {
      // Splice the step's (already-collapsed) children directly under the flow
      newChildren.push(...collapsedChild.children.map((c) => ({ ...c, depth: c.depth - 1 })))
    } else {
      newChildren.push(collapsedChild)
    }
  }
  return { ...node, children: newChildren }
}

// ---------------------------------------------------------------------------
// Kind icon mapping
// ---------------------------------------------------------------------------

function KindIcon({ node }: { node: SpanNode }) {
  const size = 12
  switch (node.kind) {
    case 'session':
      return <Users size={size} className="text-(--qw-fg-muted) shrink-0" />
    case 'flow':
      return <GitBranch size={size} className="text-violet-400 shrink-0" />
    case 'step':
      return <Layers size={size} className="text-indigo-400 shrink-0" />
    case 'handoff':
      return <ArrowRightLeft size={size} className="text-orange-400/70 shrink-0" />
    case 'composition':
      if (node.composition?.kind === 'swarm') {
        return <ArrowLeftRight size={size} className="text-amber-400 shrink-0" />
      }
      return <Network size={size} className="text-fuchsia-400 shrink-0" />
    case 'trace': {
      const role = node.trace?.role
      if (role === 'agent-step') return <Bot size={size} className="text-indigo-400 shrink-0" />
      if (role === 'resolve') return <CheckCircle size={size} className="text-(--qw-fg-muted) shrink-0" />
      return <Sparkles size={size} className="text-cyan-400 shrink-0" />
    }
    default:
      return <Sparkles size={12} className="text-(--qw-fg-faint) shrink-0" />
  }
}

// ---------------------------------------------------------------------------
// Border color for selected state
// ---------------------------------------------------------------------------

function kindBorderColor(kind: SpanNode['kind']): string {
  switch (kind) {
    case 'session':
      return 'border-l-(--qw-fg-muted)'
    case 'flow':
      return 'border-l-violet-400'
    case 'step':
      return 'border-l-indigo-400'
    case 'trace':
      return 'border-l-cyan-400'
    case 'handoff':
      return 'border-l-orange-400'
    case 'composition':
      return 'border-l-fuchsia-400'
  }
}

// ---------------------------------------------------------------------------
// Status dot
// ---------------------------------------------------------------------------

function StatusDot({ status }: { status: SpanNode['status'] }) {
  const base = 'w-1.5 h-1.5 rounded-full shrink-0'
  switch (status) {
    case 'success':
      return <span className={`${base} bg-emerald-400`} />
    case 'error':
      return <span className={`${base} bg-red-400`} />
    case 'running':
      return <span className={`${base} bg-blue-400 animate-pulse`} />
    case 'stale':
      return <span className={`${base} bg-amber-400`} />
  }
}

// ---------------------------------------------------------------------------
// SpanRow
// ---------------------------------------------------------------------------

interface SpanRowProps {
  node: SpanNode
  isSelected: boolean
  isCollapsed: boolean
  onSelect: (id: string) => void
  onToggle: (id: string) => void
}

function SpanRow({ node, isSelected, isCollapsed, onSelect, onToggle }: SpanRowProps) {
  const hasChildren = node.children.length > 0
  const semanticKind = semanticKindFor(node)

  return (
    <button
      type="button"
      className={`
        flex items-center w-full text-left text-[11px] h-7 group cursor-pointer
        ${isSelected ? `bg-(--qw-bg-muted) border-l-2 ${kindBorderColor(node.kind)}` : 'border-l-2 border-l-transparent hover:bg-(--qw-bg-muted)/50'}
      `}
      style={{ paddingLeft: node.depth * 20 }}
      onClick={() => onSelect(node.id)}
    >
      {/* Chevron */}
      <span
        className="w-4 h-4 flex items-center justify-center shrink-0"
        onClick={(e) => {
          if (hasChildren) {
            e.stopPropagation()
            onToggle(node.id)
          }
        }}
      >
        {hasChildren ? (
          isCollapsed ? (
            <ChevronRight size={12} className="text-(--qw-fg-faint)" />
          ) : (
            <ChevronDown size={12} className="text-(--qw-fg-faint)" />
          )
        ) : null}
      </span>

      {/* Status dot */}
      <span className="mx-1 flex items-center">
        <StatusDot status={node.status} />
      </span>

      {/* Kind chip (colored, design pattern) */}
      <span
        className="mr-2 shrink-0 rounded-[3px] px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.06em]"
        style={{
          color: kindHexColor(semanticKind),
          background: 'var(--qw-bg, transparent)',
          boxShadow: `inset 0 0 0 1px ${kindHexColor(semanticKind)}`,
        }}
      >
        {semanticKind}
      </span>

      {/* Label */}
      <span
        className={`truncate min-w-0 flex-1 ${node.kind === 'handoff' ? 'text-orange-400/60 italic' : node.composition?.kind === 'swarm' ? 'text-amber-300' : node.kind === 'composition' ? 'text-fuchsia-300' : 'text-(--qw-fg)'}`}
      >
        {node.label}
      </span>

      {/* Swarm handoff path badge */}
      {node.kind === 'composition' && node.composition?.kind === 'swarm' && node.composition.handoffPath && (
        <span className="text-[9px] text-amber-400/70 tabular-nums shrink-0 ml-1.5 truncate max-w-[200px]">
          {node.composition.handoffPath.join(' → ')}
        </span>
      )}

      {/* Swarm hop count badge */}
      {node.kind === 'composition' && node.composition?.kind === 'swarm' && node.composition.handoffCount != null && (
        <span className="text-[9px] text-amber-400/60 tabular-nums shrink-0 ml-1">
          {node.composition.handoffCount} {node.composition.handoffCount === 1 ? 'hop' : 'hops'}
        </span>
      )}

      {/* Composition agreement badge */}
      {node.kind === 'composition' && node.composition?.agreement != null && (
        <span className="text-[9px] text-fuchsia-400/70 tabular-nums shrink-0 ml-1.5">
          {Math.round(node.composition.agreement * 100)}% agree
        </span>
      )}

      {/* Handoff data sizing (ghost row) */}
      {node.kind === 'handoff' && node.delegate && (
        <span className="text-[9px] text-orange-400/50 tabular-nums shrink-0 ml-1.5">
          {node.delegate.inputSize != null && node.delegate.outputSize != null
            ? `${node.delegate.inputSize}B → ${node.delegate.outputSize}B`
            : ''}
          {node.delegate.handoffId ? ` · ${node.delegate.handoffId}` : ''}
        </span>
      )}

      {/* Model badge */}
      {node.model && (
        <span className="text-[9px] bg-(--qw-bg-muted) text-(--qw-fg-muted) rounded px-1 ml-1.5 shrink-0">{node.model}</span>
      )}

      {/* Dropped context warning */}
      {node.trace?.inspect?.droppedContexts?.length != null && node.trace.inspect.droppedContexts.length > 0 && (
        <span
          className="text-[9px] text-amber-400 ml-1 shrink-0"
          title={`${node.trace.inspect.droppedContexts.length} context(s) dropped`}
        >
          ⚠
        </span>
      )}

      {/* Budget warning */}
      {node.trace?.inspect?.totalTokens != null &&
        node.trace.inspect.tokenBudget != null &&
        node.trace.inspect.totalTokens > node.trace.inspect.tokenBudget * 0.9 && (
          <span
            className="text-[9px] text-red-400 ml-1 shrink-0"
            title={`Token usage: ${node.trace.inspect.totalTokens}/${node.trace.inspect.tokenBudget} (${Math.round((node.trace.inspect.totalTokens / node.trace.inspect.tokenBudget) * 100)}%)`}
          >
            ●
          </span>
        )}

      {/* Tokens */}
      {node.tokens != null && (
        <span className="text-(--qw-fg-faint) tabular-nums ml-2 shrink-0">{formatTokens(node.tokens)}</span>
      )}

      {/* Duration */}
      {node.durationMs != null && (
        <span className="text-(--qw-fg-faint) tabular-nums ml-2 shrink-0">{formatDuration(node.durationMs)}</span>
      )}

      {/* Cost */}
      {node.cost != null && <span className="text-(--qw-fg-faint) tabular-nums ml-2 shrink-0">{formatCost(node.cost)}</span>}

      <span className="w-2 shrink-0" />
    </button>
  )
}

// ---------------------------------------------------------------------------
// Semantic kind label helpers (design pattern: per-row kind chip).
// Values come from the backend's canonical primitive taxonomy.
// ---------------------------------------------------------------------------

type SemanticKind =
  | 'flow'
  | 'session'
  | 'step'
  | 'agent'
  | 'generate'
  | 'resolve'
  | 'tool'
  | 'retrieval'
  | 'score'
  | 'handoff'
  | 'swarm'
  | 'pipeline'
  | 'consensus'
  | 'trace'
  | 'memory'
  | 'embed'
  | 'security'
  | 'other'

function semanticKindFor(node: SpanNode): SemanticKind {
  switch (node.primitive) {
    case 'composition.pipeline':
    case 'pipeline':
      return 'pipeline'
    case 'composition.parallel':
    case 'parallel':
      return 'flow'
    case 'composition.consensus':
    case 'consensus':
      return 'consensus'
    case 'composition.swarm':
    case 'swarm':
      return 'swarm'
    case 'flow.run':
    case 'flow':
    case 'eval.flow':
    case 'eval.run':
      return 'flow'
    case 'flow.step':
      return 'step'
    case 'agent.run':
    case 'agent':
      return 'agent'
    case 'generation.call':
    case 'generation.stream':
    case 'generation':
      return 'generate'
    case 'tool.call':
    case 'tool.approval':
    case 'tool':
      return 'tool'
    case 'retrieval.query':
    case 'retrieval':
    case 'retrieval.stage':
      return 'retrieval'
    case 'scoring.judge':
    case 'judge':
      return 'score'
    case 'handoff.prepare':
    case 'handoff':
    case 'delegate.invoke':
    case 'delegate':
      return 'handoff'
    case 'memory.read':
    case 'memory.write':
    case 'memory':
    case 'blackboard':
      return 'memory'
    case 'embedding.call':
    case 'embed':
      return 'embed'
    case 'security.warning':
    case 'security':
      return 'security'
    case 'prompt.resolve':
      return 'resolve'
    case 'citation.check':
      return 'score'
    case 'trace':
    case 'run':
      return 'trace'
  }
  if (node.kind === 'flow') return 'flow'
  if (node.kind === 'session') return 'session'
  if (node.kind === 'step') return 'step'
  if (node.kind === 'handoff') return 'handoff'
  return node.kind === 'trace' ? 'trace' : 'other'
}

function kindHexColor(k: SemanticKind): string {
  switch (k) {
    case 'flow':
      return 'var(--qw-crux)'
    case 'agent':
    case 'swarm':
    case 'consensus':
      return 'var(--qw-iris)'
    case 'generate':
    case 'pipeline':
      return 'var(--qw-warn)'
    case 'tool':
      return 'var(--qw-fg-muted)'
    case 'retrieval':
      return 'var(--qw-ok)'
    case 'score':
    case 'memory':
      return 'var(--qw-iris)'
    case 'embed':
    case 'security':
      return 'var(--qw-danger)'
    case 'handoff':
      return 'var(--qw-fg-faint)'
    case 'session':
    case 'step':
    case 'resolve':
    case 'trace':
      return 'var(--qw-fg-muted)'
    case 'other':
      return 'var(--qw-fg-muted)'
  }
}

// ---------------------------------------------------------------------------
// Waterfall bar color helpers
// ---------------------------------------------------------------------------

function kindBarColor(kind: SpanNode['kind']): string {
  switch (kind) {
    case 'session':
      return 'bg-(--qw-fg-faint)'
    case 'flow':
      return 'bg-violet-500'
    case 'step':
      return 'bg-indigo-500'
    case 'trace':
      return 'bg-cyan-500'
    case 'handoff':
      return 'bg-orange-500'
    case 'composition':
      return 'bg-fuchsia-500'
  }
}

function kindBarColorFaded(kind: SpanNode['kind']): string {
  switch (kind) {
    case 'session':
      return 'bg-(--qw-fg-faint)/30'
    case 'flow':
      return 'bg-violet-500/30'
    case 'step':
      return 'bg-indigo-500/30'
    case 'trace':
      return 'bg-cyan-500/30'
    case 'handoff':
      return 'bg-orange-500/30'
    case 'composition':
      return 'bg-fuchsia-500/30'
  }
}

// ---------------------------------------------------------------------------
// WaterfallRow
// ---------------------------------------------------------------------------

interface WaterfallRowProps {
  node: SpanNode
  isSelected: boolean
  isCollapsed: boolean
  onSelect: (id: string) => void
  onToggle: (id: string) => void
  timelineStart: number
  timelineEnd: number
}

function WaterfallRow({
  node,
  isSelected,
  isCollapsed,
  onSelect,
  onToggle,
  timelineStart,
  timelineEnd,
}: WaterfallRowProps) {
  const hasChildren = node.children.length > 0
  const timeRange = timelineEnd - timelineStart
  const isError = node.status === 'error'
  const isRunning = node.status === 'running'

  // Calculate bar position/width as percentage
  const barLeft = timeRange > 0 ? ((node.startedAt - timelineStart) / timeRange) * 100 : 0
  const barWidth =
    timeRange > 0 && node.durationMs != null
      ? Math.max((node.durationMs / timeRange) * 100, 0.5)
      : isRunning
        ? Math.max(100 - barLeft, 0.5)
        : 0.5 // minimal sliver for zero-duration

  return (
    <button
      type="button"
      className={`
        flex items-center w-full text-left text-[11px] h-7 group cursor-pointer
        ${isSelected ? `bg-(--qw-bg-muted) border-l-2 ${kindBorderColor(node.kind)}` : 'border-l-2 border-l-transparent hover:bg-(--qw-bg-muted)/50'}
      `}
      onClick={() => onSelect(node.id)}
    >
      {/* Left side: label area (fixed width) */}
      <div className="flex items-center shrink-0" style={{ width: 220, paddingLeft: node.depth * 16 }}>
        {/* Chevron */}
        <span
          className="w-4 h-4 flex items-center justify-center shrink-0"
          onClick={(e) => {
            if (hasChildren) {
              e.stopPropagation()
              onToggle(node.id)
            }
          }}
        >
          {hasChildren ? (
            isCollapsed ? (
              <ChevronRight size={12} className="text-(--qw-fg-faint)" />
            ) : (
              <ChevronDown size={12} className="text-(--qw-fg-faint)" />
            )
          ) : null}
        </span>

        {/* Status dot */}
        <span className="mx-1 flex items-center">
          <StatusDot status={node.status} />
        </span>

        {/* Kind chip */}
        <span
          className="mr-2 shrink-0 rounded-[3px] px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.06em]"
          style={{
            color: kindHexColor(semanticKindFor(node)),
            boxShadow: `inset 0 0 0 1px ${kindHexColor(semanticKindFor(node))}`,
          }}
        >
          {semanticKindFor(node)}
        </span>

        {/* Label */}
        <span className="text-(--qw-fg) truncate min-w-0 flex-1 text-[10px]">{node.label}</span>
      </div>

      {/* Right side: waterfall bar */}
      <div className="flex-1 min-w-0 h-full flex items-center px-2">
        <div className="relative w-full h-3 rounded-sm overflow-hidden">
          {/* Track background */}
          <div className={`absolute inset-0 ${kindBarColorFaded(node.kind)} rounded-sm`} />
          {/* Active bar */}
          <div
            className={`
              absolute top-0 h-full rounded-sm
              ${isError ? 'bg-red-500' : kindBarColor(node.kind)}
              ${isRunning && !isError ? 'animate-pulse' : ''}
            `}
            style={{
              left: `${barLeft}%`,
              width: `${barWidth}%`,
            }}
          />
        </div>
      </div>

      {/* Duration label */}
      <span className="text-(--qw-fg-faint) tabular-nums text-[10px] shrink-0 w-14 text-right pr-2">
        {formatDuration(node.durationMs)}
      </span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// SpanTree
// ---------------------------------------------------------------------------

export function SpanTree({ tree, selectedId, onSelect }: SpanTreeProps) {
  const [searchQuery, setSearchQuery] = useState('')
  // The span tree filter rebuilds a potentially large render. Defer the
  // query value so typing stays responsive on big traces; dim the
  // results while we're still catching up.
  const deferredSearch = useDeferredValue(searchQuery)
  const isFilterPending = searchQuery !== deferredSearch
  const [viewMode, setViewMode] = useState<ViewMode>('tree')
  const containerRef = useRef<HTMLDivElement>(null)

  // Default collapsed state: expand first 2 levels
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    const all = collectAll(tree)
    const initialCollapsed = new Set<string>()
    for (const n of all) {
      if (n.depth >= 2 && n.children.length > 0) {
        initialCollapsed.add(n.id)
      }
    }
    return initialCollapsed
  })

  const toggleCollapse = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // Collapse redundant FLOW > STEP wrappers before any other processing
  const cleanedTree = useMemo(() => collapseRedundantSteps(tree), [tree])

  // Apply search filter — reads the deferred value so the input itself
  // never blocks on a heavy tree filter pass.
  const filteredTree = useMemo(() => {
    if (!deferredSearch.trim()) return cleanedTree
    return filterTree(cleanedTree, deferredSearch.trim())
  }, [cleanedTree, deferredSearch])

  // Flatten visible nodes
  const visibleNodes = useMemo(() => {
    if (!filteredTree) return []
    return flattenVisible(filteredTree, collapsed)
  }, [filteredTree, collapsed])

  // Compute timeline range from all visible nodes
  const { timelineStart, timelineEnd } = useMemo(() => {
    if (visibleNodes.length === 0) return { timelineStart: 0, timelineEnd: 1 }
    let min = Infinity
    let max = -Infinity
    for (const n of visibleNodes) {
      if (n.startedAt < min) min = n.startedAt
      const end = n.startedAt + (n.durationMs ?? 0)
      if (end > max) max = end
    }
    if (min === max) max = min + 1 // prevent zero range
    return { timelineStart: min, timelineEnd: max }
  }, [visibleNodes])

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!selectedId) return
      const idx = visibleNodes.findIndex((n) => n.id === selectedId)
      if (idx === -1) return

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault()
          if (idx < visibleNodes.length - 1) onSelect(visibleNodes[idx + 1].id)
          break
        }
        case 'ArrowUp': {
          e.preventDefault()
          if (idx > 0) onSelect(visibleNodes[idx - 1].id)
          break
        }
        case 'ArrowRight': {
          e.preventDefault()
          const node = visibleNodes[idx]
          if (node.children.length > 0 && collapsed.has(node.id)) {
            toggleCollapse(node.id)
          }
          break
        }
        case 'ArrowLeft': {
          e.preventDefault()
          const node = visibleNodes[idx]
          if (node.children.length > 0 && !collapsed.has(node.id)) {
            toggleCollapse(node.id)
          }
          break
        }
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectedId, visibleNodes, collapsed, onSelect, toggleCollapse])

  return (
    <div className="flex flex-col h-full min-h-0 bg-(--qw-bg-elev)">
      {/* Header controls */}
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-(--qw-border) shrink-0">
        <div className="flex items-center flex-1 gap-1.5 bg-(--qw-bg-muted) rounded px-2 py-1">
          <Search size={12} className="text-(--qw-fg-faint) shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter spans..."
            className="bg-transparent text-[11px] text-(--qw-fg) placeholder:text-(--qw-fg-faint) outline-none w-full"
          />
        </div>

        {/* Tree / Timeline toggle */}
        <div className="flex items-center bg-(--qw-bg-muted) rounded p-0.5 shrink-0">
          <button
            type="button"
            title="Tree view"
            className={`flex items-center justify-center w-6 h-5 rounded cursor-pointer ${
              viewMode === 'tree' ? 'bg-(--qw-border-strong) text-(--qw-fg)' : 'text-(--qw-fg-faint) hover:text-(--qw-fg-muted)'
            }`}
            onClick={() => setViewMode('tree')}
          >
            <List size={12} />
          </button>
          <button
            type="button"
            title="Timeline view"
            className={`flex items-center justify-center w-6 h-5 rounded cursor-pointer ${
              viewMode === 'timeline' ? 'bg-(--qw-border-strong) text-(--qw-fg)' : 'text-(--qw-fg-faint) hover:text-(--qw-fg-muted)'
            }`}
            onClick={() => setViewMode('timeline')}
          >
            <BarChart3 size={12} />
          </button>
        </div>
      </div>

      {/* Content — dimmed while the deferred filter is still catching up
          with the typed query (typical on very deep traces). */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 overflow-y-auto transition-opacity"
        style={{ opacity: isFilterPending ? 0.6 : 1 }}
      >
        {filteredTree == null ? (
          <div className="flex items-center justify-center h-full text-(--qw-fg-faint) text-[11px]">No spans match filter</div>
        ) : viewMode === 'tree' ? (
          visibleNodes.map((node) => (
            <RowErrorBoundary key={node.id} rowKey={node.id}>
              <SpanRow
                node={node}
                isSelected={node.id === selectedId}
                isCollapsed={collapsed.has(node.id)}
                onSelect={onSelect}
                onToggle={toggleCollapse}
              />
            </RowErrorBoundary>
          ))
        ) : (
          visibleNodes.map((node) => (
            <RowErrorBoundary key={node.id} rowKey={node.id}>
              <WaterfallRow
                node={node}
                isSelected={node.id === selectedId}
                isCollapsed={collapsed.has(node.id)}
                onSelect={onSelect}
                onToggle={toggleCollapse}
                timelineStart={timelineStart}
                timelineEnd={timelineEnd}
              />
            </RowErrorBoundary>
          ))
        )}
      </div>
    </div>
  )
}

interface SpanTreeProps {
  tree: SpanNode
  selectedId: string | null
  onSelect: (id: string) => void
}
