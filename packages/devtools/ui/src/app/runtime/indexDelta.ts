import type {
  IndexDiagnostic,
  IndexSourceFile,
  ProjectDefinition,
  ProjectIndexData,
} from '@/types'

export interface IndexDeltaMessage {
  readonly type: 'index:delta'
  readonly generation: number
  readonly file: string
  readonly definitions: {
    readonly added?: readonly ProjectDefinition[]
    readonly changed?: readonly ProjectDefinition[]
    readonly removedIds?: readonly string[]
  }
  readonly diagnostics?: readonly IndexDiagnostic[]
  readonly sourceRow?: IndexSourceFile | null
}

/** Normalizes Project Index snapshots from REST or WebSocket payloads. */
export function normalizeProjectIndexData(index: Partial<ProjectIndexData>): ProjectIndexData {
  return {
    schemaVersion: index.schemaVersion ?? 1,
    prompts: index.prompts ?? [],
    contexts: index.contexts ?? [],
    tools: index.tools ?? [],
    project: index.project,
    indexedAt: index.indexedAt,
    indexing: index.indexing,
    definitions: index.definitions ?? [],
    relations: index.relations ?? [],
    diagnostics: index.diagnostics ?? [],
    lintFindings: index.lintFindings ?? [],
    sources: index.sources ?? [],
  }
}

/** Applies one per-file Project Index delta to an existing cached snapshot. */
export function applyIndexDelta(
  current: ProjectIndexData | undefined,
  delta: IndexDeltaMessage,
): ProjectIndexData | undefined {
  if (!current) return undefined
  return {
    ...current,
    definitions: applyDefinitionDelta(current.definitions, delta.definitions),
    diagnostics: [
      ...current.diagnostics.filter((diagnostic) => diagnostic.source?.file !== delta.file),
      ...(delta.diagnostics ?? []),
    ],
    sources: applySourceDelta(current.sources, delta.file, delta.sourceRow),
  }
}

function applyDefinitionDelta(
  current: readonly ProjectDefinition[],
  delta: IndexDeltaMessage['definitions'],
): ProjectDefinition[] {
  const removed = new Set(delta.removedIds ?? [])
  const incoming = new Map<string, ProjectDefinition>()
  for (const definition of [...(delta.added ?? []), ...(delta.changed ?? [])]) {
    incoming.set(definition.id, definition)
  }

  const next: ProjectDefinition[] = []
  for (const definition of current) {
    if (removed.has(definition.id)) continue
    const replacement = incoming.get(definition.id)
    if (replacement) {
      next.push(replacement)
      incoming.delete(definition.id)
      continue
    }
    next.push(definition)
  }
  next.push(...incoming.values())
  return next
}

function applySourceDelta(
  current: readonly IndexSourceFile[],
  file: string,
  sourceRow: IndexDeltaMessage['sourceRow'],
): IndexSourceFile[] {
  if (!sourceRow) return current.filter((source) => source.file !== file)
  const next = current.filter((source) => source.file !== file)
  next.push(sourceRow)
  next.sort((left, right) => left.file < right.file ? -1 : left.file > right.file ? 1 : 0)
  return next
}
