import type {
  CatalogDiagnostic,
  CatalogSourceFile,
  ProjectDefinition,
  ProjectRelation,
} from '@crux/core/catalog'

export type DefinitionId = string & { readonly __brand: 'DefinitionId' }
export type RelationId = string & { readonly __brand: 'RelationId' }
export type SourceFilePath = string & { readonly __brand: 'SourceFilePath' }

export type CatalogCapability =
  | 'definition'
  | 'relation'
  | 'schema'
  | 'source'
  | 'runtime-join'
  | 'quality-join'
  | 'partial'

export interface CatalogDefinitionNode {
  definition: ProjectDefinition
  producedBy: SourceFilePath[]
  contributedBy: SourceFilePath[]
  relationIds: RelationId[]
  capabilities: CatalogCapability[]
}

export interface CatalogRelationEdge {
  relation: ProjectRelation
  producedBy: SourceFilePath[]
}

export interface CatalogSourceNode {
  file: SourceFilePath
  status: CatalogSourceFile['status']
  definitionIds: DefinitionId[]
  relationIds: RelationId[]
  dependencies: SourceFilePath[]
  dependents: SourceFilePath[]
  diagnostics: string[]
}

export interface CatalogGraph {
  definitions: Map<DefinitionId, CatalogDefinitionNode>
  relations: Map<RelationId, CatalogRelationEdge>
  files: Map<SourceFilePath, CatalogSourceNode>
  diagnostics: CatalogDiagnostic[]
}

export interface AddDefinitionInput {
  definition: ProjectDefinition
  producedBy?: readonly string[]
  contributedBy?: readonly string[]
  capabilities?: readonly CatalogCapability[]
}

export interface AddRelationInput {
  relation: ProjectRelation
  producedBy?: readonly string[]
}

export interface AddSourceInput {
  source: CatalogSourceFile
}

export type GraphMutation =
  | { kind: 'definition'; input: AddDefinitionInput }
  | { kind: 'relation'; input: AddRelationInput }
  | { kind: 'source'; input: AddSourceInput }
  | { kind: 'dependency'; from: string; to: string }
  | { kind: 'diagnostic'; input: CatalogDiagnostic }

export interface CatalogGraphBuilder {
  readonly graph: CatalogGraph
  apply(mutation: GraphMutation): void
  addDefinition(input: AddDefinitionInput): DefinitionId
  addRelation(input: AddRelationInput): RelationId
  addSource(input: AddSourceInput): SourceFilePath
  addDiagnostic(input: CatalogDiagnostic): void
  addDependency(from: string, to: string): void
}

export function definitionId(value: string): DefinitionId {
  return value as DefinitionId
}

export function relationId(value: string): RelationId {
  return value as RelationId
}

export function sourceFilePath(value: string): SourceFilePath {
  return value as SourceFilePath
}
