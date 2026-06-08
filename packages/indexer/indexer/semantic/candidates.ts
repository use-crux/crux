import type {
  JsonSchema,
  ProjectDefinition,
  ProjectDefinitionKind,
  ProjectRelation,
  ProjectSourceRef,
  ProjectSourceRefRole,
} from '@crux/core/project-index'
import type * as ts from 'typescript'

export type SemanticDefinitionKind = Extract<
  ProjectDefinition['kind'],
  | 'prompt'
  | 'context'
  | 'tool'
  | 'agent'
  | 'flow'
  | 'composition.parallel'
  | 'composition.pipeline'
  | 'composition.swarm'
  | 'composition.consensus'
  | 'routing.router'
  | 'routing.cascade'
  | 'routing.fallback'
  | 'constraint'
  | 'guardrail'
  | 'memory'
  | 'memory.block'
  | 'blackboard'
  | 'workspace'
>

export type SemanticSchemaProperty = 'input' | 'inputSchema' | 'output' | 'parameters' | 'args' | 'schema'
export type SemanticSchemaMetadataKey = 'inputSchema' | 'outputSchema' | 'argsSchema' | 'schema'

/**
 * Syntax-level Crux definition found before TypeScript symbol resolution.
 */
export interface SemanticDefinitionCandidate {
  readonly definitionId: string
  readonly kind: SemanticDefinitionKind
  readonly name: string
  readonly object: ts.ObjectLiteralExpression
  readonly call?: ts.CallExpression
}

/**
 * Analyzer input for a definition property that may resolve to a schema.
 */
export interface SemanticSchemaCandidate extends SemanticDefinitionCandidate {
  readonly property: SemanticSchemaProperty
  readonly metadataKey: SemanticSchemaMetadataKey
  readonly expression: ts.Expression
}

/**
 * Analyzer input for a definition property that may resolve to source code.
 */
export interface SemanticSourceRefCandidate extends SemanticDefinitionCandidate {
  readonly property: string
  readonly role: ProjectSourceRefRole
  readonly expression: ts.Expression
  readonly metadata?: ProjectSourceRef['metadata']
}

/**
 * TypeScript symbol resolution result with enough source data to emit refs.
 */
export interface SemanticResolvedSource {
  readonly symbol: string
  readonly sourceFile: ts.SourceFile
  readonly declaration: ts.Declaration
  readonly expression?: ts.Expression
  readonly functionName?: string
}

/**
 * Index target resolved from a semantic expression.
 */
export interface SemanticTarget {
  readonly id: string
  readonly kind: ProjectDefinitionKind
}

/**
 * Additional definition, ref, and relation facts derived from one candidate.
 */
export interface SemanticDefinitionEnrichment {
  readonly definition: ProjectDefinition
  readonly sourceRefs?: readonly ProjectSourceRef[]
  readonly relations?: readonly ProjectRelation[]
}

/**
 * Shared semantic analyzer context for candidate-level analyzers.
 */
export interface SemanticAnalyzerContext {
  readonly checker: ts.TypeChecker
}

/**
 * Resolved memory block metadata used to enrich authored memory definitions.
 */
export interface SemanticMemoryBlock {
  readonly id?: string
  readonly kind?: string
  readonly schema?: JsonSchema
  readonly schemaExpression?: ts.Expression
  readonly schemaResolved?: SemanticResolvedSource
  readonly object: ts.ObjectLiteralExpression
}
