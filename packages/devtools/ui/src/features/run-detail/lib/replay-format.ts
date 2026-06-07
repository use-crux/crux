import type { ChipTone } from '@/qw/shell/primitives'
import type { IconName } from '@/qw/shell/nav'
import { primitiveAccentVar } from './families'

// Replay (Story lens) pseudo-kinds that frame an *event* rather than a span —
// these keep their own framing colours.
const EVENT_COLOR: Record<string, string> = {
  input: 'var(--qw-crux)',
  output: 'var(--qw-warn)',
  error: 'var(--qw-danger)',
}

// Canonical replay kind → a representative primitive, so the Story lens colours
// derive from the one family resolver (`./families`) instead of a private copy
// that drifts (v2 §8.8).
const CANON_PRIMITIVE: Record<string, string> = {
  flow: 'flow.run',
  step: 'flow.step',
  agent: 'agent.run',
  generate: 'generation.call',
  generation: 'generation.call',
  llm: 'generation.call',
  tool: 'tool.call',
  retrieval: 'retrieval.query',
  retrieve: 'retrieval.query',
  source: 'retrieval.query',
  handoff: 'handoff.prepare',
  transition: 'transition',
  delegate: 'delegate.invoke',
  score: 'scoring.judge',
  judge: 'scoring.judge',
  memory: 'memory.read',
  composition: 'composition.swarm',
}

const KNOWN_KINDS = new Set([...Object.keys(EVENT_COLOR), ...Object.keys(CANON_PRIMITIVE)])

export function canonicalKind(kind: string | undefined): string {
  const k = (kind ?? '').toLowerCase()
  if (!k) return ''
  if (KNOWN_KINDS.has(k)) return k
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
  const canon = canonicalKind(kind)
  if (EVENT_COLOR[canon]) return EVENT_COLOR[canon]
  const primitive = CANON_PRIMITIVE[canon]
  return primitive ? primitiveAccentVar(primitive) : 'var(--qw-fg-muted)'
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
