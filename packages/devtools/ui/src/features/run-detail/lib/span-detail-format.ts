import type { CorrelatedEvent } from '@/types'

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString()
}

export function formatDuration(ms: number | undefined): string {
  if (ms == null) return '...'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function formatCost(cost: number): string {
  if (cost < 0.001) return `$${cost.toFixed(6)}`
  if (cost < 0.01) return `$${cost.toFixed(4)}`
  if (cost < 1) return `$${cost.toFixed(3)}`
  return `$${cost.toFixed(2)}`
}

export function formatTokens(n: number | undefined): string {
  if (n == null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

export function tryParseJson(str: string): unknown {
  try {
    return JSON.parse(str)
  } catch {
    return str
  }
}

export function summarizeEvent(event: CorrelatedEvent): string {
  const data = event.data
  switch (event.eventType) {
    case 'memory:read': {
      const prefix = data.memoryType ? `[${String(data.memoryType)}] ` : ''
      return `${prefix}${String(data.memoryId ?? 'memory')} ${String(data.operation ?? 'read')} (${Number(data.resultCount ?? 0)} results, ${Number(data.durationMs ?? 0)}ms)`
    }
    case 'memory:write': {
      const prefix = data.memoryType ? `[${String(data.memoryType)}] ` : ''
      return `${prefix}${String(data.memoryId ?? 'memory')} write${data.entryKey ? ` to ${String(data.entryKey)}` : ''}`
    }
    case 'embed:start':
      return `${String(data.kind ?? 'embedding')} ${String(data.name ?? 'embedding')} ${String(data.operation ?? 'embed')} (${Number(data.inputCount ?? 0)} texts, ${Number(data.chunkCount ?? 0)} chunks)`
    case 'embed:end': {
      const cost = data.cost != null ? `, $${Number(data.cost).toFixed(4)}` : ''
      const error = data.error ? `: ${String(data.error)}` : ''
      const cache =
        data.cacheHitCount != null || data.cacheMissCount != null
          ? `, cache ${Number(data.cacheHitCount ?? 0)} hit / ${Number(data.cacheMissCount ?? 0)} miss`
          : ''
      const retry = data.retryCount != null ? `, ${Number(data.retryCount)} retries` : ''
      const truncated = data.truncatedCount != null ? `, ${Number(data.truncatedCount)} truncated` : ''
      return `${String(data.kind ?? 'embedding')} ${String(data.name ?? 'embedding')} completed in ${Number(data.durationMs ?? 0)}ms${cost}${cache}${retry}${truncated}${error}`
    }
    case 'retrieval:start':
      return `${String(data.mode ?? 'retrieval')} retriever ${String(data.retrieverId ?? 'retriever')} searching "${String(data.query ?? '')}"${data.limit != null ? ` (limit ${Number(data.limit)})` : ''}`
    case 'retrieval:end': {
      const error = data.error ? `: ${String(data.error)}` : ''
      return `${String(data.mode ?? 'retrieval')} retriever ${String(data.retrieverId ?? 'retriever')} returned ${Number(data.resultCount ?? 0)} hits in ${Number(data.durationMs ?? 0)}ms${error}`
    }
    case 'retrieval:stage:start':
      return `${String(data.stageKind ?? 'stage')} stage ${String(data.stageName ?? 'stage')} started (${String(data.phase ?? 'query')})`
    case 'retrieval:stage:end': {
      const input =
        data.inputQueryCount != null
          ? `${Number(data.inputQueryCount)} queries`
          : `${Number(data.inputHitCount ?? 0)} hits`
      const output =
        data.outputQueryCount != null
          ? `${Number(data.outputQueryCount)} queries`
          : `${Number(data.outputHitCount ?? 0)} hits`
      const error = data.error ? `: ${String(data.error)}` : ''
      return `${String(data.stageKind ?? 'stage')} stage ${String(data.stageName ?? 'stage')} ${input} -> ${output} in ${Number(data.durationMs ?? 0)}ms${error}`
    }
    case 'workspace:operation': {
      const error = data.error ? `: ${String(data.error)}` : ''
      const size = data.size != null ? `, ${Number(data.size)}B` : ''
      return `${String(data.operation ?? 'workspace')} ${String(data.path ?? '')} ${String(data.status ?? 'success')} in ${Number(data.durationMs ?? 0)}ms${size}${error}`
    }
    case 'index:start':
      return `${String(data.operation ?? 'index')} via ${String(data.indexerId ?? 'indexer')} (${Number(data.sourceCount ?? 0)} sources, ${Number(data.chunkCount ?? 0)} chunks)`
    case 'index:end': {
      const error = data.error ? `: ${String(data.error)}` : ''
      return `${String(data.operation ?? 'index')} via ${String(data.indexerId ?? 'indexer')} completed in ${Number(data.durationMs ?? 0)}ms${data.deletedCount != null ? `, deleted ${Number(data.deletedCount)}` : ''}${error}`
    }
    case 'budget:check':
      return `${String(data.level ?? 'normal')} pressure at ${Number(data.used ?? 0)}/${Number(data.used ?? 0) + Number(data.available ?? 0)} tokens`
    case 'compact:start':
      return `${String(data.reason ?? 'compaction')} (${Number(data.inputMessageCount ?? 0)} msgs, ${Number(data.inputTokens ?? 0)} tok)`
    case 'compact:end':
      return `${Number(data.outputTokens ?? 0)} tok after compaction (${Number(data.durationMs ?? 0)}ms)`
    case 'judge:result':
      return `score ${Number(data.score ?? 0).toFixed(2)} for ${String(data.metricId ?? 'judge metric')}`
    case 'blackboard:update': {
      const fields = Array.isArray(data.fieldsChanged) ? (data.fieldsChanged as string[]).join(', ') : ''
      return `${String(data.boardId ?? 'board')}: ${fields || 'updated'}`
    }
    case 'handoff:prepare': {
      const from = data.fromAgent ? String(data.fromAgent) : null
      const to = data.toAgent ? String(data.toAgent) : null
      const agents = from && to ? `${from} → ${to} via ` : ''
      return `${agents}${String(data.handoffId ?? 'handoff')} (${Number(data.inputSize ?? 0)}→${Number(data.outputSize ?? 0)}B)`
    }
    case 'delegate:start':
      return `${String(data.delegateId ?? 'delegate')} → ${String(data.handoffId ?? 'handoff')} (${Number(data.inputSize ?? 0)}B)`
    case 'delegate:complete':
      return `${String(data.delegateId ?? 'delegate')} completed (${Number(data.durationMs ?? 0)}ms, ${Number(data.inputSize ?? 0)}→${Number(data.outputSize ?? 0)}B)`
    case 'tool:start': {
      const argsPreview = data.args ? JSON.stringify(data.args).slice(0, 60) : ''
      return `→ ${String(data.toolName ?? 'tool')}(${argsPreview}${argsPreview.length >= 60 ? '…' : ''})`
    }
    case 'tool:end': {
      const dMs = Number(data.durationMs ?? 0)
      const est = data.estimated ? '~' : ''
      const savings =
        typeof data.tokenSavingsEstimate === 'number' && data.tokenSavingsEstimate > 0
          ? `, shaped -${data.tokenSavingsEstimate}B`
          : ''
      if (data.error) return `✗ ${String(data.toolName ?? 'tool')} (${est}${dMs}ms): ${String(data.error)}`
      return `← ${String(data.toolName ?? 'tool')} (${est}${dMs}ms${savings})`
    }
    case 'tool:approval:request':
      return `Approval requested for ${String(data.toolName ?? 'tool')}`
    case 'tool:approval:decision':
      return `${data.approved ? 'Approved' : 'Denied'} ${String(data.toolName ?? 'tool')}${
        data.reason ? `: ${String(data.reason)}` : ''
      }`
    case 'plan:created':
      return `Plan created: "${String(data.title ?? '')}" (${String(data.status ?? 'draft')})`
    case 'plan:updated':
      return `Plan updated: v${Number(data.version ?? 0)} — ${Array.isArray(data.changes) ? (data.changes as string[]).join(', ') : 'updated'}`
    case 'tasklist:created':
      return `Task list created${data.planId ? ` for plan ${String(data.planId).slice(0, 8)}` : ''}`
    case 'tasklist:completed':
      return `Task list completed: ${Number(data.totalTasks ?? 0)} tasks in ${Number(data.durationMs ?? 0)}ms`
    case 'tasklist:discarded':
      return `Task list discarded: ${String(data.reason ?? 'no reason')}`
    case 'task:added':
      return `Task added: "${String(data.label ?? '')}"${(data.assignee as { agent?: string } | undefined)?.agent ? ` → ${(data.assignee as { agent: string }).agent}` : ''}`
    case 'task:updated':
      return `Task ${String(data.taskId ?? '')}: ${String(data.status ?? '')}${data.progress ? ` — ${String(data.progress)}` : ''}`
    case 'task:removed':
      return `Task removed: ${String(data.taskId ?? '')}`
    default:
      return event.eventType
  }
}

export function getEventColor(event: CorrelatedEvent): string {
  // Memory type-specific colors
  if (event.eventType === 'memory:read' || event.eventType === 'memory:write') {
    const mt = event.data.memoryType as string | undefined
    if (mt === 'episodic') return event.eventType === 'memory:read' ? 'bg-violet-400' : 'bg-violet-500'
    if (mt === 'semantic') return event.eventType === 'memory:read' ? 'bg-teal-400' : 'bg-teal-500'
  }
  return EVENT_COLORS[event.eventType] ?? 'bg-zinc-500'
}

// ─────────────────────────────────────────────────────────────────
// Style maps
// ─────────────────────────────────────────────────────────────────

export const ROLE_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  resolve: {
    bg: 'bg-zinc-800 border-zinc-700',
    text: 'text-zinc-400',
    label: 'Resolve',
  },
  'agent-step': {
    bg: 'bg-indigo-500/10 border-indigo-500/30',
    text: 'text-indigo-400',
    label: 'Agent Step',
  },
  generate: {
    bg: 'bg-cyan-500/10 border-cyan-500/30',
    text: 'text-cyan-400',
    label: 'Generate',
  },
}

export const FINISH_REASON_STYLES: Record<string, string> = {
  stop: 'text-zinc-400 bg-zinc-800 border-zinc-700',
  length: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
  'tool-calls': 'text-blue-400 bg-blue-500/10 border-blue-500/30',
  'content-filter': 'text-red-400 bg-red-500/10 border-red-500/30',
  error: 'text-red-400 bg-red-500/10 border-red-500/30',
}

export const STATUS_COLORS: Record<string, string> = {
  success: 'bg-emerald-400',
  error: 'bg-red-400',
  running: 'bg-blue-400 animate-pulse',
}

export const EVENT_COLORS: Record<string, string> = {
  'embed:start': 'bg-cyan-400',
  'embed:end': 'bg-cyan-500',
  'memory:read': 'bg-blue-400',
  'memory:write': 'bg-blue-500',
  'budget:check': 'bg-green-400',
  'compact:start': 'bg-fuchsia-400',
  'compact:end': 'bg-fuchsia-500',
  'judge:result': 'bg-amber-400',
  'blackboard:update': 'bg-cyan-400',
  'handoff:prepare': 'bg-cyan-500',
  'delegate:start': 'bg-orange-400',
  'delegate:complete': 'bg-orange-500',
  'tool:start': 'bg-lime-400',
  'tool:end': 'bg-lime-500',
  'tool:approval:request': 'bg-amber-400',
  'tool:approval:decision': 'bg-amber-500',
  'workspace:operation': 'bg-teal-400',
  'plan:created': 'bg-blue-400',
  'plan:updated': 'bg-blue-300',
  'tasklist:created': 'bg-violet-400',
  'tasklist:completed': 'bg-emerald-400',
  'tasklist:discarded': 'bg-amber-400',
  'task:added': 'bg-sky-400',
  'task:updated': 'bg-sky-300',
  'task:removed': 'bg-zinc-500',
}

export const HANDOFF_KIND_STYLES: Record<string, string> = {
  agent: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/30',
  tool: 'text-blue-400 bg-blue-500/10 border-blue-500/30',
  routing: 'text-violet-400 bg-violet-500/10 border-violet-500/30',
  user: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  system: 'text-zinc-400 bg-zinc-800 border-zinc-700',
}
