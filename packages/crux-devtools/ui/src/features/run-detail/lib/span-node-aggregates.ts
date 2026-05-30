import type { SpanNode } from '@/features/observability/lib/span-tree'
import type { Trace } from '@/types'

export function collectTraces(node: SpanNode): Trace[] {
  const traces: Trace[] = []
  if (node.kind === 'trace' && node.trace) traces.push(node.trace)
  for (const child of node.children) traces.push(...collectTraces(child))
  return traces
}

export function collectTraceNodes(node: SpanNode): SpanNode[] {
  const nodes: SpanNode[] = []
  if (node.kind === 'trace' && node.trace) nodes.push(node)
  for (const child of node.children) nodes.push(...collectTraceNodes(child))
  return nodes
}

export function countKind(node: SpanNode, kind: SpanNode['kind']): number {
  let count = node.kind === kind ? 1 : 0
  for (const child of node.children) count += countKind(child, kind)
  return count
}

export function sumField(node: SpanNode, field: 'cost' | 'tokens'): number {
  let sum = 0
  if (node.kind === 'trace' && node[field] != null) sum += node[field]!
  for (const child of node.children) sum += sumField(child, field)
  return sum
}
