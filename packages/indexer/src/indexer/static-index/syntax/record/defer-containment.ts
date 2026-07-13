import type { ExtractedFacts } from '../../../extensions'
import type { StaticFoundDefinition } from '../../../types'

const DEFER_OWNER_KINDS = new Set([
  'prompt',
  'tool',
  'agent',
  'flow',
  'flow.step',
])

/** Adds containment only when normalized source ranges prove one indexed owner. */
export function withDeferredWorkContainment(
  facts: readonly ExtractedFacts[],
  found: readonly StaticFoundDefinition[],
): ExtractedFacts[] {
  const owners = found.filter(({ definition }) =>
    DEFER_OWNER_KINDS.has(definition.kind),
  )
  const ownerByDeferredWorkId = new Map<string, string>()
  for (const { definition } of found) {
    if (definition.kind !== 'deferred-work') continue
    const line = definition.source?.line
    if (line === undefined) continue
    const owner = owners
      .filter(({ definition: candidate }) => {
        const range = candidate.sourceSnippet?.range
        if (!range) return false
        return (
          range.file === definition.source?.file &&
          range.startLine <= line &&
          (range.endLine ?? range.startLine) >= line
        )
      })
      .sort((left, right) => sourceRangeSize(left) - sourceRangeSize(right))[0]
    if (owner) ownerByDeferredWorkId.set(definition.id, owner.definition.id)
  }
  return facts.map((fact) => withContainmentReference(fact, ownerByDeferredWorkId))
}

function sourceRangeSize(found: StaticFoundDefinition): number {
  const range = found.definition.sourceSnippet?.range
  return (range?.endLine ?? 0) - (range?.startLine ?? 0)
}

function withContainmentReference(
  fact: ExtractedFacts,
  ownerByDeferredWorkId: ReadonlyMap<string, string>,
): ExtractedFacts {
  const deferredWork = fact.definitions?.find(({ definition }) =>
    ownerByDeferredWorkId.has(definition.id),
  )
  if (!deferredWork) return fact
  return {
    ...fact,
    references: [
      ...(fact.references ?? []),
      {
        type: 'defer.contained_by',
        fromId: deferredWork.definition.id,
        toId: ownerByDeferredWorkId.get(deferredWork.definition.id)!,
      },
    ],
  }
}
