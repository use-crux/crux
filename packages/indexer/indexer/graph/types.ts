import type {
  IndexDiagnostic,
  IndexSourceFile,
  ProjectDefinition,
  ProjectRelation,
} from '@crux/core/project-index'

export type DefinitionId = string & { readonly __brand: 'DefinitionId' }
export type RelationId = string & { readonly __brand: 'RelationId' }
export type SourceFilePath = string & { readonly __brand: 'SourceFilePath' }

export type IndexCapability =
  | 'definition'
  | 'relation'
  | 'schema'
  | 'source'
  | 'runtime-join'
  | 'quality-join'
  | 'partial'

export interface IndexDefinitionNode {
  definition: ProjectDefinition
  producedBy: SourceFilePath[]
  contributedBy: SourceFilePath[]
  relationIds: RelationId[]
  capabilities: IndexCapability[]
}

export interface IndexRelationEdge {
  relation: ProjectRelation
  producedBy: SourceFilePath[]
}

export interface IndexSourceNode {
  file: SourceFilePath
  status: IndexSourceFile['status']
  shardId?: string
  definitionIds: DefinitionId[]
  relationIds: RelationId[]
  dependencies: SourceFilePath[]
  dependents: SourceFilePath[]
  diagnostics: string[]
}

export interface IndexGraph {
  definitions: Map<DefinitionId, IndexDefinitionNode>
  relations: Map<RelationId, IndexRelationEdge>
  files: Map<SourceFilePath, IndexSourceNode>
  diagnostics: IndexDiagnostic[]
}

export interface AddDefinitionInput {
  definition: ProjectDefinition
  producedBy?: readonly string[]
  contributedBy?: readonly string[]
  capabilities?: readonly IndexCapability[]
}

export interface AddRelationInput {
  relation: ProjectRelation
  producedBy?: readonly string[]
}

export interface AddSourceInput {
  source: IndexSourceFile
}

export type GraphMutation =
  | { kind: 'definition'; input: AddDefinitionInput }
  | { kind: 'relation'; input: AddRelationInput }
  | { kind: 'source'; input: AddSourceInput }
  | { kind: 'dependency'; from: string; to: string }
  | { kind: 'diagnostic'; input: IndexDiagnostic }

export interface IndexGraphBuilder {
  readonly graph: IndexGraph
  apply(mutation: GraphMutation): void
  addDefinition(input: AddDefinitionInput): DefinitionId
  addRelation(input: AddRelationInput): RelationId
  addSource(input: AddSourceInput): SourceFilePath
  addDiagnostic(input: IndexDiagnostic): void
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
