import type { IndexDiagnostic, IndexSourceFile, ProjectDefinition, SourceLocation } from '@crux/core/project-index'
import { sourceForFile } from './ast/snippets'
import type { SourceGraph } from './types'

export function addSource(
  sources: Map<string, IndexSourceFile>,
  file: string,
  status: IndexSourceFile['status'],
): void {
  const existing = sources.get(file)
  sources.set(file, {
    file,
    status: existing?.status === 'error' ? 'error' : status,
    definitionIds: existing?.definitionIds,
    dependencies: existing?.dependencies,
    dependents: existing?.dependents,
    diagnostics: existing?.diagnostics,
    shardId: existing?.shardId,
  })
}

export function sourceStatus(
  sources: readonly IndexSourceFile[],
  file: string,
  status: IndexSourceFile['status'],
): readonly IndexSourceFile[] {
  const existing = sources.find((source) => source.file === file)
  const updated: IndexSourceFile = {
    file,
    status: existing?.status === 'error' ? 'error' : status,
    definitionIds: existing?.definitionIds,
    dependencies: existing?.dependencies,
    dependents: existing?.dependents,
    diagnostics: existing?.diagnostics,
    shardId: existing?.shardId,
  }
  return mergeSources([...sources.filter((source) => source.file !== file), updated])
}

export function mergeSources(sources: IndexSourceFile[]): IndexSourceFile[] {
  const merged = new Map<string, IndexSourceFile>()
  for (const source of sources) {
    const existing = merged.get(source.file)
    if (!existing) {
      merged.set(source.file, source)
      continue
    }
    merged.set(source.file, {
      file: source.file,
      status:
        existing.status === 'error' || source.status === 'error'
          ? 'error'
          : existing.status === 'partial' || source.status === 'partial'
            ? 'partial'
            : 'indexed',
      definitionIds: dedupeStrings([...(existing.definitionIds ?? []), ...(source.definitionIds ?? [])]),
      dependencies: dedupeStrings([...(existing.dependencies ?? []), ...(source.dependencies ?? [])]),
      dependents: dedupeStrings([...(existing.dependents ?? []), ...(source.dependents ?? [])]),
      diagnostics: dedupeStrings([...(existing.diagnostics ?? []), ...(source.diagnostics ?? [])]),
      shardId: source.shardId ?? existing.shardId,
    })
  }
  return [...merged.values()]
}

export function attachSourceGraph(
  sources: IndexSourceFile[],
  definitions: readonly ProjectDefinition[],
  graph: SourceGraph,
): IndexSourceFile[] {
  const definitionIdsByFile = new Map<string, string[]>()
  for (const definition of definitions) {
    const file = definition.source?.file
    if (!file) continue
    definitionIdsByFile.set(file, [...(definitionIdsByFile.get(file) ?? []), definition.id])
  }

  const dependentsByFile = new Map<string, string[]>()
  for (const [file, dependencies] of graph.dependenciesByFile) {
    for (const dependency of dependencies) {
      dependentsByFile.set(dependency, [...(dependentsByFile.get(dependency) ?? []), file])
    }
  }

  const files = new Set([
    ...sources.map((source) => source.file),
    ...definitionIdsByFile.keys(),
    ...graph.dependenciesByFile.keys(),
    ...dependentsByFile.keys(),
  ])
  const sourceByFile = new Map(sources.map((source) => [source.file, source]))

  return [...files].sort().map((file) => {
    const source = sourceByFile.get(file)
    return {
      file,
      status: source?.status ?? 'indexed',
      definitionIds: dedupeStrings([...(source?.definitionIds ?? []), ...(definitionIdsByFile.get(file) ?? [])]),
      dependencies: dedupeStrings([...(source?.dependencies ?? []), ...(graph.dependenciesByFile.get(file) ?? [])]),
      dependents: dedupeStrings([...(source?.dependents ?? []), ...(dependentsByFile.get(file) ?? [])]),
      diagnostics: source?.diagnostics,
    }
  })
}

export function backfillDefinitionSources(
  definitions: ProjectDefinition[],
  diagnostics: IndexDiagnostic[],
  configFile: string | undefined,
): ProjectDefinition[] {
  const sourceByDefinitionId = new Map<string, SourceLocation>()
  for (const diagnostic of diagnostics) {
    if (!diagnostic.source?.file) continue
    for (const id of diagnostic.relatedDefinitionIds ?? []) {
      if (!sourceByDefinitionId.has(id)) sourceByDefinitionId.set(id, diagnostic.source)
    }
  }
  const configSource = configFile ? sourceForFile(configFile) : undefined
  return definitions.map((definition) => {
    if (definition.source?.file) return definition
    const source = sourceByDefinitionId.get(definition.id) ?? configSource
    return source ? { ...definition, source } : definition
  })
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)]
}
