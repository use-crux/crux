import type { ProjectDefinition } from '@crux/core/catalog'

export function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const map = new Map<string, T>()
  for (const item of items) map.set(item.id, item)
  return [...map.values()]
}

export function mergeDefinitionsById(items: ProjectDefinition[]): ProjectDefinition[] {
  const merged = new Map<string, ProjectDefinition>()
  for (const item of items) {
    const existing = merged.get(item.id)
    if (!existing) {
      merged.set(item.id, item)
      continue
    }
    merged.set(item.id, mergeDefinition(existing, item))
  }
  return [...merged.values()]
}

function mergeDefinition(existing: ProjectDefinition, incoming: ProjectDefinition): ProjectDefinition {
  const keepExistingCore = fidelityRank(existing.fidelity) >= fidelityRank(incoming.fidelity)
  const metadata = keepExistingCore
    ? { ...(incoming.metadata ?? {}), ...(existing.metadata ?? {}) }
    : { ...(existing.metadata ?? {}), ...(incoming.metadata ?? {}) }
  return {
    ...(keepExistingCore ? incoming : existing),
    ...(keepExistingCore ? existing : incoming),
    source: incoming.source ?? existing.source,
    sourceSnippet: incoming.sourceSnippet ?? existing.sourceSnippet,
    description: incoming.description ?? existing.description,
    tags: incoming.tags ?? existing.tags,
    path: incoming.path ?? existing.path,
    fidelity: keepExistingCore ? existing.fidelity : incoming.fidelity,
    status: incoming.status ?? existing.status,
    fingerprint: incoming.fingerprint ?? existing.fingerprint,
    metadata,
    quality: incoming.quality ?? existing.quality,
    sourceRefs: mergeSourceRefs(existing.sourceRefs, incoming.sourceRefs),
  }
}

function fidelityRank(fidelity: ProjectDefinition['fidelity']): number {
  switch (fidelity) {
    case 'resolved':
      return 3
    case 'partial':
      return 2
    case 'error':
      return 1
    default:
      return 0
  }
}

function mergeSourceRefs(
  existing: ProjectDefinition['sourceRefs'],
  incoming: ProjectDefinition['sourceRefs'],
): ProjectDefinition['sourceRefs'] {
  const refs = [...(existing ?? []), ...(incoming ?? [])]
  if (refs.length === 0) return undefined
  const merged = new Map<string, NonNullable<ProjectDefinition['sourceRefs']>[number]>()
  for (const ref of refs) merged.set(ref.id, ref)
  return [...merged.values()]
}
