import { expect } from 'vitest'
import type { CruxGraphNodeRef, CruxGraphRecord } from '../../../src/observability'

const terminalRunStatuses = new Set(['ok', 'error', 'blocked', 'cancelled', 'suspended'])
const terminalSpanStatuses = new Set(['ok', 'error', 'blocked', 'cancelled', 'suspended', 'skipped'])

/**
 * Assert core graph integrity for records emitted through the public
 * observability API.
 *
 * This intentionally checks behavior-level invariants instead of emission
 * internals: lifecycle starts have one terminal end, terminal statuses are
 * terminal, and event/edge references point at nodes present in the graph.
 */
export function expectBalancedGraph(records: readonly CruxGraphRecord[]): void {
  const runStarts = new Set<string>()
  const spanStarts = new Set<string>()
  const spanNodes = new Set<string>()
  const artifactNodes = new Set<string>()
  const runEnds = countTerminalRuns(records)
  const spanEnds = countTerminalSpans(records)

  for (const record of records) {
    switch (record.type) {
      case 'run:start':
        expect(runStarts.has(record.runId)).toBe(false)
        runStarts.add(record.runId)
        break
      case 'run:end':
        expect(terminalRunStatuses.has(record.status)).toBe(true)
        break
      case 'span:start':
        expect(spanStarts.has(record.spanId)).toBe(false)
        spanStarts.add(record.spanId)
        spanNodes.add(record.spanId)
        break
      case 'span':
        expect(terminalSpanStatuses.has(record.status)).toBe(true)
        spanNodes.add(record.spanId)
        break
      case 'span:end':
        expect(terminalSpanStatuses.has(record.status)).toBe(true)
        break
      case 'artifact':
        artifactNodes.add(record.artifactId)
        break
      case 'span:event':
      case 'edge':
        break
    }
  }

  for (const runId of runStarts) {
    expect(runEnds.get(runId) ?? 0).toBe(1)
  }
  for (const spanId of spanStarts) {
    expect(spanEnds.get(spanId) ?? 0).toBe(1)
  }

  for (const record of records) {
    if (record.type === 'span:event') {
      expect(spanNodes.has(record.spanId)).toBe(true)
    }
    if (record.type === 'artifact' && record.spanId) {
      expect(spanNodes.has(record.spanId)).toBe(true)
    }
    if (record.type === 'edge') {
      expectNodeRef(record.from, runStarts, spanNodes, artifactNodes)
      expectNodeRef(record.to, runStarts, spanNodes, artifactNodes)
    }
  }
}

function countTerminalRuns(records: readonly CruxGraphRecord[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const record of records) {
    if (record.type === 'run:end') increment(counts, record.runId)
  }
  return counts
}

function countTerminalSpans(records: readonly CruxGraphRecord[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const record of records) {
    if (record.type === 'span:end') increment(counts, record.spanId)
  }
  return counts
}

function increment(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1)
}

function expectNodeRef(
  ref: CruxGraphNodeRef,
  runNodes: ReadonlySet<string>,
  spanNodes: ReadonlySet<string>,
  artifactNodes: ReadonlySet<string>,
): void {
  switch (ref.kind) {
    case 'run':
      expect(runNodes.has(ref.id)).toBe(true)
      return
    case 'span':
      expect(spanNodes.has(ref.id)).toBe(true)
      return
    case 'artifact':
      expect(artifactNodes.has(ref.id)).toBe(true)
      return
  }
}
