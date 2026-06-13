/**
 * Failure-first triage helpers (design `dx-workbench` `RunDetailTriage`,
 * RUN-DETAIL-SPEC §6 "Tree — triage state").
 *
 * Pure tree walks over the canonical `SpanNode` structure, shared by the
 * error stepper (run header), the collapse-to-failure-path default (SpanTree),
 * and the status minimap. All operate on the **full** span set, never just the
 * currently-rendered rows.
 */

import type { SpanNode } from '@/features/observability/lib/span-tree'

/** Pre-order list of every span id whose status is `error`. The order matches
 *  the tree's visual top→bottom order, so stepping `next`/`prev` walks failures
 *  the way the eye reads them. */
export function collectFailingSpanIds(node: SpanNode): string[] {
  const out: string[] = []
  const walk = (n: SpanNode): void => {
    if (n.status === 'error') out.push(n.id)
    for (const child of n.children) walk(child)
  }
  walk(node)
  return out
}

/** Ids of every node whose subtree (including itself) contains a failure.
 *  These are the nodes the Tree keeps **expanded** in triage state — the path
 *  down to each failing span — so siblings off the path fold away. */
export function nodesOnFailurePath(node: SpanNode): Set<string> {
  const keep = new Set<string>()
  const walk = (n: SpanNode): boolean => {
    let hasFailure = n.status === 'error'
    for (const child of n.children) {
      if (walk(child)) hasFailure = true
    }
    if (hasFailure) keep.add(n.id)
    return hasFailure
  }
  walk(node)
  return keep
}

/** The flat, pre-order status sequence over the **whole** tree. Drives the
 *  status minimap's density strip (orientation, not navigation). */
export function flatStatuses(node: SpanNode): SpanNode['status'][] {
  const out: SpanNode['status'][] = []
  const walk = (n: SpanNode): void => {
    out.push(n.status)
    for (const child of n.children) walk(child)
  }
  walk(node)
  return out
}

/** Step a shared selection through the failing-span list. Returns the id to
 *  select next, wrapping at the ends; falls back to the first/last failure
 *  when the current selection isn't itself a failure. */
export function stepFailure(
  failing: readonly string[],
  current: string | null | undefined,
  dir: 1 | -1,
): string | null {
  if (failing.length === 0) return null
  const idx = current ? failing.indexOf(current) : -1
  if (idx === -1) return dir === 1 ? failing[0] : failing[failing.length - 1]
  const next = (idx + dir + failing.length) % failing.length
  return failing[next]
}
