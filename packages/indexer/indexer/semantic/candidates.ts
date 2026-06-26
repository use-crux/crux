import type {
  JsonSchema,
  ProjectDefinition,
  ProjectDefinitionKind,
  ProjectRelation,
  ProjectSourceRef,
  ProjectSourceRefRole,
} from '@crux/core/project-index'
import type * as ts from 'typescript'
import type {
  SemanticCompilerDeclaration,
  SemanticCompilerSourceFile,
  SemanticCompilerSymbol,
  SemanticCompilerType,
  SemanticCompilerView,
} from './compiler-view'
import type { SemanticSyntaxNode, SemanticSyntaxSourceFile } from './syntax-view'

type SemanticDefaultCallNode<TNode extends SemanticSyntaxNode> = TNode extends ts.ObjectLiteralExpression
  ? ts.CallExpression
  : TNode

export type SemanticAnalyzerView = SemanticCompilerView<
  ts.Node,
  ts.SourceFile & SemanticCompilerSourceFile,
  ts.Declaration & SemanticCompilerDeclaration,
  SemanticCompilerSymbol,
  SemanticCompilerType
>

export type SemanticDefinitionKind = Extract<
  ProjectDefinition['kind'],
  | 'prompt'
  | 'context'
  | 'injectable'
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
export interface SemanticDefinitionCandidate<
  TNode extends SemanticSyntaxNode = ts.ObjectLiteralExpression,
  TCall extends SemanticSyntaxNode = SemanticDefaultCallNode<TNode>,
> {
  readonly definitionId: string
  readonly kind: SemanticDefinitionKind
  readonly name: string
  readonly object: TNode
  readonly call?: TCall
}

/**
 * Analyzer input for a definition property that may resolve to a schema.
 */
export interface SemanticSchemaCandidate<
  TNode extends SemanticSyntaxNode = ts.ObjectLiteralExpression,
  TCall extends SemanticSyntaxNode = SemanticDefaultCallNode<TNode>,
  TExpression extends SemanticSyntaxNode = ts.Expression,
> extends SemanticDefinitionCandidate<TNode, TCall> {
  readonly property: SemanticSchemaProperty
  readonly metadataKey: SemanticSchemaMetadataKey
  readonly expression: TExpression
}

/**
 * Analyzer input for a definition property that may resolve to source code.
 */
export interface SemanticSourceRefCandidate<
  TNode extends SemanticSyntaxNode = ts.ObjectLiteralExpression,
  TCall extends SemanticSyntaxNode = SemanticDefaultCallNode<TNode>,
  TExpression extends SemanticSyntaxNode = ts.Expression,
> extends SemanticDefinitionCandidate<TNode, TCall> {
  readonly property: string
  readonly role: ProjectSourceRefRole
  readonly expression: TExpression
  readonly metadata?: ProjectSourceRef['metadata']
}

/**
 * TypeScript symbol resolution result with enough source data to emit refs.
 */
export interface SemanticResolvedSource<
  TExpression extends SemanticSyntaxNode = ts.Expression,
  TSourceFile extends SemanticSyntaxSourceFile = ts.SourceFile & SemanticCompilerSourceFile,
  TDeclaration extends SemanticSyntaxNode = ts.Declaration,
> {
  readonly symbol: string
  readonly sourceFile: TSourceFile
  readonly declaration: TDeclaration
  readonly expression?: TExpression
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
  /** Backend-neutral compiler view for source, symbol, and type queries. */
  readonly view: SemanticAnalyzerView
}

/**
 * Resolved memory block metadata used to enrich authored memory definitions.
 */
export interface SemanticMemoryBlock<
  TObject extends SemanticSyntaxNode = ts.ObjectLiteralExpression,
  TExpression extends SemanticSyntaxNode = ts.Expression,
> {
  readonly id?: string
  readonly kind?: string
  readonly schema?: JsonSchema
  readonly schemaExpression?: TExpression
  readonly schemaResolved?: SemanticResolvedSource<TExpression>
  readonly object: TObject
}
