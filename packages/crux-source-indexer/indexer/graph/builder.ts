import type {
  CatalogDiagnostic,
  CatalogSourceFile,
  ProjectDefinition,
  ProjectRelation,
} from '@crux/core/catalog'
import { mergeDefinitionsById } from '../merge'
import type {
  AddDefinitionInput,
  AddRelationInput,
  AddSourceInput,
  CatalogCapability,
  CatalogDefinitionNode,
  CatalogGraph,
  CatalogGraphBuilder,
  CatalogRelationEdge,
  CatalogSourceNode,
  DefinitionId,
  GraphMutation,
  RelationId,
  SourceFilePath,
} from './types'
import { definitionId, relationId, sourceFilePath } from './types'

export function createCatalogGraphBuilder(): CatalogGraphBuilder {
  return new DefaultCatalogGraphBuilder()
}

class DefaultCatalogGraphBuilder implements CatalogGraphBuilder {
  readonly graph: CatalogGraph = {
    definitions: new Map(),
    relations: new Map(),
    files: new Map(),
    diagnostics: [],
  }

  apply(mutation: GraphMutation): void {
    switch (mutation.kind) {
      case 'definition':
        this.addDefinition(mutation.input)
        return
      case 'relation':
        this.addRelation(mutation.input)
        return
      case 'source':
        this.addSource(mutation.input)
        return
      case 'dependency':
        this.addDependency(mutation.from, mutation.to)
        return
      case 'diagnostic':
        this.addDiagnostic(mutation.input)
        return
    }
  }

  addDefinition(input: AddDefinitionInput): DefinitionId {
    const id = definitionId(input.definition.id)
    const existing = this.graph.definitions.get(id)
    const producedBy = normalizedPaths(
      input.producedBy ?? (input.definition.source?.file ? [input.definition.source.file] : []),
    )
    const contributedBy = normalizedPaths(input.contributedBy)
    const capabilities: CatalogCapability[] = dedupe([...(input.capabilities ?? []), 'definition'])
    const node: CatalogDefinitionNode = existing
      ? {
          definition: mergeDefinitionsById([existing.definition, input.definition])[0] ?? input.definition,
          producedBy: dedupeBranded([...existing.producedBy, ...producedBy]),
          contributedBy: dedupeBranded([...existing.contributedBy, ...contributedBy]),
          relationIds: existing.relationIds,
          capabilities: dedupe([...existing.capabilities, ...capabilities]),
        }
      : {
          definition: input.definition,
          producedBy,
          contributedBy,
          relationIds: [],
          capabilities,
        }
    this.graph.definitions.set(id, node)
    for (const file of [...node.producedBy, ...node.contributedBy]) {
      const source = this.ensureSource(file, 'indexed')
      source.definitionIds = dedupeBranded([...source.definitionIds, id])
    }
    return id
  }

  addRelation(input: AddRelationInput): RelationId {
    const id = relationId(input.relation.id)
    const existing = this.graph.relations.get(id)
    const producedBy = normalizedPaths(
      input.producedBy ?? (input.relation.source?.file ? [input.relation.source.file] : []),
    )
    const edge: CatalogRelationEdge = existing
      ? { relation: input.relation, producedBy: dedupeBranded([...existing.producedBy, ...producedBy]) }
      : { relation: input.relation, producedBy }
    this.graph.relations.set(id, edge)
    for (const file of edge.producedBy) {
      const source = this.ensureSource(file, 'indexed')
      source.relationIds = dedupeBranded([...source.relationIds, id])
    }
    const from = this.graph.definitions.get(definitionId(input.relation.from))
    if (from) from.relationIds = dedupeBranded([...from.relationIds, id])
    return id
  }

  addSource(input: AddSourceInput): SourceFilePath {
    const file = sourceFilePath(input.source.file)
    const source = this.ensureSource(file, input.source.status)
    source.status = mergeStatus(source.status, input.source.status)
    source.definitionIds = dedupeBranded([
      ...source.definitionIds,
      ...normalizedDefinitionIds(input.source.definitionIds),
    ])
    source.dependencies = dedupeBranded([...source.dependencies, ...normalizedPaths(input.source.dependencies)])
    source.dependents = dedupeBranded([...source.dependents, ...normalizedPaths(input.source.dependents)])
    source.diagnostics = dedupe([...(source.diagnostics ?? []), ...(input.source.diagnostics ?? [])])
    return file
  }

  addDiagnostic(input: CatalogDiagnostic): void {
    if (!this.graph.diagnostics.some((diagnostic) => diagnostic.id === input.id)) {
      this.graph.diagnostics.push(input)
    }
    if (input.source?.file) {
      const source = this.ensureSource(
        sourceFilePath(input.source.file),
        input.severity === 'error' ? 'error' : 'partial',
      )
      source.diagnostics = dedupe([...source.diagnostics, input.id])
    }
  }

  addDependency(from: string, to: string): void {
    const fromPath = sourceFilePath(from)
    const toPath = sourceFilePath(to)
    const fromSource = this.ensureSource(fromPath, 'indexed')
    const toSource = this.ensureSource(toPath, 'indexed')
    fromSource.dependencies = dedupeBranded([...fromSource.dependencies, toPath])
    toSource.dependents = dedupeBranded([...toSource.dependents, fromPath])
  }

  private ensureSource(file: SourceFilePath, status: CatalogSourceFile['status']): CatalogSourceNode {
    const existing = this.graph.files.get(file)
    if (existing) {
      existing.status = mergeStatus(existing.status, status)
      return existing
    }
    const source: CatalogSourceNode = {
      file,
      status,
      definitionIds: [],
      relationIds: [],
      dependencies: [],
      dependents: [],
      diagnostics: [],
    }
    this.graph.files.set(file, source)
    return source
  }
}

export function graphDefinitions(graph: CatalogGraph): ProjectDefinition[] {
  return [...graph.definitions.values()].map((node) => node.definition)
}

export function graphRelations(graph: CatalogGraph): ProjectRelation[] {
  return [...graph.relations.values()].map((edge) => edge.relation)
}

export function graphSources(graph: CatalogGraph): CatalogSourceFile[] {
  return [...graph.files.values()]
    .sort((a, b) => a.file.localeCompare(b.file))
    .map((source) => ({
      file: source.file,
      status: source.status,
      definitionIds: [...source.definitionIds],
      dependencies: [...source.dependencies],
      dependents: [...source.dependents],
      diagnostics: [...source.diagnostics],
    }))
}

function normalizedPaths(values: readonly string[] | undefined): SourceFilePath[] {
  return dedupe((values ?? []).filter((value): value is string => typeof value === 'string' && value.length > 0)).map(
    sourceFilePath,
  )
}

function normalizedDefinitionIds(values: readonly string[] | undefined): DefinitionId[] {
  return dedupe((values ?? []).filter((value): value is string => typeof value === 'string' && value.length > 0)).map(
    definitionId,
  )
}

function mergeStatus(a: CatalogSourceFile['status'], b: CatalogSourceFile['status']): CatalogSourceFile['status'] {
  if (a === 'error' || b === 'error') return 'error'
  if (a === 'partial' || b === 'partial') return 'partial'
  return 'indexed'
}

function dedupe<T>(values: readonly T[]): T[] {
  return [...new Set(values)]
}

function dedupeBranded<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)]
}
