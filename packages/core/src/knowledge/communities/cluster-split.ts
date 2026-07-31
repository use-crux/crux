/**
 * Deterministic bounded agglomeration helpers for knowledge communities.
 *
 * @module
 */

/** Weighted relation between two agglomeration members. */
export interface AgglomerationLink {
  readonly leftId: string
  readonly rightId: string
  readonly weight: number
}

/** Split members by repeatedly taking the strongest budget-valid merge. */
export function agglomerateWithinBudget(input: {
  readonly memberIds: readonly string[]
  readonly links: readonly AgglomerationLink[]
  readonly budget: number
  readonly estimate: (memberIds: readonly string[]) => number
}): readonly (readonly string[])[] {
  const unique = [...new Set(input.memberIds)].sort()
  if (unique.length <= 1) {
    assertWithinBudget(unique, input.estimate(unique), input.budget)
    return [unique]
  }
  if (input.estimate(unique) <= input.budget) return [unique]

  const weights = linkWeights(input.links)
  let clusters: readonly (readonly string[])[] = unique.map((id) => [id])

  while (true) {
    const candidate = bestMerge(clusters, weights, input.budget, input.estimate)
    if (!candidate) return clusters.map(sortCluster).sort(compareClusters)

    clusters = clusters.flatMap((cluster, index) => {
      if (index === candidate.left) return [candidate.members]
      if (index === candidate.right) return []
      return [cluster]
    }).map(sortCluster).sort(compareClusters)
  }
}

function assertWithinBudget(memberIds: readonly string[], size: number, budget: number): void {
  if (size <= budget) return
  throw new Error(`Community member "${memberIds[0] ?? ''}" exceeds the input budget.`)
}

function bestMerge(
  clusters: readonly (readonly string[])[],
  weights: ReadonlyMap<string, number>,
  budget: number,
  estimate: (memberIds: readonly string[]) => number,
): MergeCandidate | null {
  let best: MergeCandidate | null = null

  for (let left = 0; left < clusters.length; left += 1) {
    for (let right = left + 1; right < clusters.length; right += 1) {
      const members = sortCluster([...(clusters[left] ?? []), ...(clusters[right] ?? [])])
      const size = estimate(members)
      if (size > budget) continue

      const candidate: MergeCandidate = {
        left,
        right,
        members,
        weight: clusterWeight(clusters[left] ?? [], clusters[right] ?? [], weights),
      }
      if (!best || compareCandidates(candidate, best) < 0) best = candidate
    }
  }

  return best
}

interface MergeCandidate {
  readonly left: number
  readonly right: number
  readonly members: readonly string[]
  readonly weight: number
}

function compareCandidates(left: MergeCandidate, right: MergeCandidate): number {
  return (
    right.weight - left.weight ||
    (left.members[0] ?? '').localeCompare(right.members[0] ?? '') ||
    clusterKey(left.members).localeCompare(clusterKey(right.members))
  )
}

function clusterWeight(
  left: readonly string[],
  right: readonly string[],
  weights: ReadonlyMap<string, number>,
): number {
  let total = 0
  for (const leftId of left) {
    for (const rightId of right) {
      total += weights.get(pairKey(leftId, rightId)) ?? 0
    }
  }
  return total
}

function linkWeights(links: readonly AgglomerationLink[]): ReadonlyMap<string, number> {
  const weights = new Map<string, number>()
  for (const link of links) {
    if (link.leftId === link.rightId || link.weight <= 0 || !Number.isFinite(link.weight)) continue
    const key = pairKey(link.leftId, link.rightId)
    weights.set(key, (weights.get(key) ?? 0) + link.weight)
  }
  return weights
}

function pairKey(left: string, right: string): string {
  return left <= right ? `${left}\0${right}` : `${right}\0${left}`
}

function sortCluster(cluster: readonly string[]): readonly string[] {
  return [...cluster].sort()
}

function compareClusters(left: readonly string[], right: readonly string[]): number {
  return clusterKey(left).localeCompare(clusterKey(right))
}

function clusterKey(cluster: readonly string[]): string {
  return cluster.join('\0')
}
