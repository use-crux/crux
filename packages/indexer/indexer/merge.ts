import type { ProjectDefinition } from '@crux/core/project-index'

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
    ? mergeMetadata(incoming.metadata, existing.metadata)
    : mergeMetadata(existing.metadata, incoming.metadata)
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

function mergeMetadata(
  base: ProjectDefinition['metadata'],
  overlay: ProjectDefinition['metadata'],
): ProjectDefinition['metadata'] {
  const metadata = { ...(base ?? {}), ...(overlay ?? {}) }
  const baseFacts = base?.facts
  const overlayFacts = overlay?.facts
  if (isRecord(baseFacts) || isRecord(overlayFacts)) {
    metadata.facts = mergeFacts(baseFacts, overlayFacts) as NonNullable<ProjectDefinition['metadata']>['facts']
  }
  return metadata
}

function mergeFacts(base: unknown, overlay: unknown): Record<string, unknown> {
  const facts = { ...(isRecord(base) ? base : {}), ...(isRecord(overlay) ? overlay : {}) }
  const useEntries = mergeList(
    isRecord(base) ? base.useEntries : undefined,
    isRecord(overlay) ? overlay.useEntries : undefined,
  )
  if (useEntries) facts.useEntries = useEntries
  return facts
}

function mergeList(base: unknown, overlay: unknown): unknown[] | undefined {
  const items = [...(Array.isArray(base) ? base : []), ...(Array.isArray(overlay) ? overlay : [])]
  if (items.length === 0) return undefined
  return items
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
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
