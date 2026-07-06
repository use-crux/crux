import type { Guardrail } from '../guardrail/types'

/** Return the next complete prefix segment to evaluate, or `null` while holding. */
export type StreamSegment = (buffer: string, last: boolean) => string | null

/** Resolve a guardrail stream option into the segmenter used by the stream engine. */
export function segmenterFor(stream: Guardrail['stream']): StreamSegment {
  if (stream === 'chunk') return chunkSegment
  if (stream === 'line') return lineSegment
  if (stream === undefined || stream === 'sentence') return sentenceSegment
  if (stream && typeof stream === 'object' && 'segment' in stream) {
    const segment = stream.segment
    if (segment === 'chunk') return chunkSegment
    if (segment === 'line') return lineSegment
    if (segment === 'sentence') return sentenceSegment
    if (segment instanceof RegExp) return regexpSegment(segment)
    if (typeof segment === 'function') return (buffer, last) => (last ? buffer : segment(buffer))
  }
  return sentenceSegment
}

/** Maximum buffered characters allowed before a holding stream guard fails closed. */
export function streamMaxHoldChars(stream: Guardrail['stream']): number {
  if (stream && typeof stream === 'object' && 'maxHold' in stream) {
    return stream.maxHold?.chars ?? 2000
  }
  return 2000
}

/** Stream overflow policy for guardrails with explicit hold-limit tuning. */
export function streamOnHoldLimit(stream: Guardrail['stream']): 'block' | 'release' {
  if (stream && typeof stream === 'object' && 'onHoldLimit' in stream) {
    return stream.onHoldLimit ?? 'block'
  }
  return 'block'
}

function chunkSegment(buffer: string): string | null {
  return buffer.length > 0 ? buffer : null
}

function lineSegment(buffer: string): string | null {
  const index = buffer.indexOf('\n')
  return index >= 0 ? buffer.slice(0, index + 1) : null
}

function sentenceSegment(buffer: string): string | null {
  const match = /[.!?]\s|\n/.exec(buffer)
  return match ? buffer.slice(0, match.index + match[0].length) : null
}

function regexpSegment(pattern: RegExp): StreamSegment {
  return (buffer) => {
    const match = pattern.exec(buffer)
    if (!match || match.index === undefined) return null
    return buffer.slice(0, match.index + match[0].length)
  }
}
