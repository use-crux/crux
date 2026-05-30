import type { ChipTone } from '@/qw/shell/primitives'
import type { IconName } from '@/qw/shell/nav'

const KIND_COLOR: Record<string, string> = {
  flow: 'var(--qw-crux)',
  agent: 'var(--qw-iris)',
  generate: 'var(--qw-warn)',
  generation: 'var(--qw-warn)',
  llm: 'var(--qw-warn)',
  tool: 'var(--qw-fg-muted)',
  retrieval: 'var(--qw-ok)',
  retrieve: 'var(--qw-ok)',
  handoff: 'var(--qw-fg-faint)',
  transition: 'var(--qw-iris)',
  delegate: 'var(--qw-fg-faint)',
  score: 'var(--qw-iris)',
  judge: 'var(--qw-iris)',
  input: 'var(--qw-crux)',
  output: 'var(--qw-warn)',
  memory: 'var(--qw-iris)',
  step: 'var(--qw-crux)',
  composition: 'var(--qw-crux)',
  source: 'var(--qw-ok)',
  error: 'var(--qw-danger)',
}

export function canonicalKind(kind: string | undefined): string {
  const k = (kind ?? '').toLowerCase()
  if (!k) return ''
  if (KIND_COLOR[k]) return k
  if (k === 'agent.run' || k === 'agent.step' || k.startsWith('agent.')) return 'agent'
  if (k === 'tool.call' || k.startsWith('tool.')) return 'tool'
  if (k === 'retrieval.stage' || k.startsWith('retrieval.') || k === 'retrieve') return 'retrieval'
  if (k === 'flow.step' || k.startsWith('flow.')) return 'flow'
  if (k === 'generation' || k.startsWith('generation.') || k === 'llm') return 'generate'
  if (k === 'handoff.transfer' || k.startsWith('handoff.')) return 'handoff'
  if (k === 'memory.read' || k === 'memory.write' || k.startsWith('memory.')) return 'memory'
  if (k === 'judge' || k === 'score' || k.startsWith('score.')) return 'score'
  return k
}

export function kindColor(kind: string | undefined): string {
  return KIND_COLOR[canonicalKind(kind)] ?? 'var(--qw-fg-muted)'
}

export function kindIcon(kind: string | undefined): IconName | null {
  switch (canonicalKind(kind)) {
    case 'flow':
      return 'trace'
    case 'agent':
      return 'brain'
    case 'generate':
    case 'output':
      return 'spark'
    case 'tool':
      return 'flask'
    case 'retrieval':
      return 'search'
    case 'memory':
      return 'layers'
    case 'handoff':
    case 'transition':
    case 'delegate':
    case 'step':
      return 'arrowRight'
    case 'score':
    case 'judge':
      return 'check'
    case 'source':
      return 'bookmark'
    case 'error':
      return 'alert'
    case 'composition':
      return 'layers'
    case 'input':
      return 'arrowDown'
    default:
      return null
  }
}

export function statusTone(status: string): ChipTone {
  if (status === 'success' || status === 'ok' || status === 'passed') return 'ok'
  if (status === 'running') return 'crux'
  if (status === 'error' || status === 'fail' || status === 'failed') return 'danger'
  return 'warn'
}

export function formatTime(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

export function parseMaybeJson(text: string): unknown | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  if (!(trimmed.startsWith('{') && trimmed.endsWith('}')) && !(trimmed.startsWith('[') && trimmed.endsWith(']')))
    return null
  try {
    return JSON.parse(trimmed)
  } catch {
    return null
  }
}
