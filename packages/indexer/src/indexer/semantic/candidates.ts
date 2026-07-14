import type {
  JsonSchema,
  ProjectDefinition,
  ProjectDefinitionKind,
  ProjectRelation,
  ProjectSourceRef,
  ProjectSourceRefRole,
} from "@use-crux/core/project-index";
import type {
  SemanticCompilerDeclaration,
  SemanticCompilerNode,
  SemanticCompilerSourceFile,
  SemanticCompilerSymbol,
  SemanticCompilerType,
  SemanticCompilerView,
} from "./compiler-view";
import type {
  SemanticSyntaxNode,
  SemanticSyntaxSourceFile,
} from "./syntax-view";

export type SemanticAnalyzerView<
  TNode extends SemanticCompilerNode = SemanticCompilerNode,
  TSourceFile extends TNode &
    SemanticCompilerSourceFile &
    SemanticSyntaxSourceFile<TNode> = TNode &
    SemanticCompilerSourceFile &
    SemanticSyntaxSourceFile<TNode>,
  TDeclaration extends TNode & SemanticCompilerDeclaration = TNode &
    SemanticCompilerDeclaration,
  TSymbol extends SemanticCompilerSymbol = SemanticCompilerSymbol,
  TType extends SemanticCompilerType = SemanticCompilerType,
> = SemanticCompilerView<TNode, TSourceFile, TDeclaration, TSymbol, TType>;

/** Extracts the backend-owned syntax node type from a semantic analyzer view. */
export type SemanticAnalyzerNode<TView extends SemanticAnalyzerView> =
  TView extends SemanticCompilerView<
    infer TNode,
    infer _TSourceFile,
    infer _TDeclaration,
    infer _TSymbol,
    infer _TType
  >
    ? TNode
    : never;

/** Extracts the backend-owned source-file type from a semantic analyzer view. */
export type SemanticAnalyzerSourceFile<TView extends SemanticAnalyzerView> =
  TView extends SemanticCompilerView<
    infer _TNode,
    infer TSourceFile,
    infer _TDeclaration,
    infer _TSymbol,
    infer _TType
  >
    ? TSourceFile
    : never;

/** Extracts the backend-owned declaration node type from a semantic analyzer view. */
export type SemanticAnalyzerDeclaration<TView extends SemanticAnalyzerView> =
  TView extends SemanticCompilerView<
    infer _TNode,
    infer _TSourceFile,
    infer TDeclaration,
    infer _TSymbol,
    infer _TType
  >
    ? TDeclaration
    : never;

export type SemanticDefinitionKind = Extract<
  ProjectDefinition["kind"],
  | "prompt"
  | "context"
  | "injectable"
  | "tool"
  | "mcp.server"
  | "agent"
  | "flow"
  | "composition.parallel"
  | "composition.pipeline"
  | "composition.swarm"
  | "composition.consensus"
  | "routing.router"
  | "routing.split"
  | "routing.retry"
  | "routing.cascade"
  | "routing.fallback"
  | "constraint"
  | "guardrail"
  | "toolPolicy"
  | "memory"
  | "memory.block"
  | "blackboard"
  | "workspace"
  | "rag.knowledgeBase"
  | "rag.recipe"
  | "rag.reranker"
  | "rag.retriever"
  | "storage.recordStore"
  | "storage.vectorStore"
  | "storage.assetStore"
  | "storage.bundle"
  | "storage.scope"
>;

export type SemanticSchemaProperty =
  | "input"
  | "inputSchema"
  | "output"
  | "parameters"
  | "args"
  | "schema";
export type SemanticSchemaMetadataKey =
  | "inputSchema"
  | "outputSchema"
  | "argsSchema"
  | "schema";

/**
 * Syntax-level Crux definition found before TypeScript symbol resolution.
 */
export interface SemanticDefinitionCandidate<
  TNode extends SemanticSyntaxNode = SemanticCompilerNode,
  TCall extends SemanticSyntaxNode = TNode,
> {
  readonly definitionId: string;
  readonly kind: SemanticDefinitionKind;
  readonly name: string;
  readonly object: TNode;
  readonly call?: TCall;
}

/**
 * Analyzer input for a definition property that may resolve to a schema.
 */
export interface SemanticSchemaCandidate<
  TNode extends SemanticSyntaxNode = SemanticCompilerNode,
  TCall extends SemanticSyntaxNode = TNode,
  TExpression extends SemanticSyntaxNode = TNode,
> extends SemanticDefinitionCandidate<TNode, TCall> {
  readonly property: SemanticSchemaProperty;
  readonly metadataKey: SemanticSchemaMetadataKey;
  readonly expression: TExpression;
}

/**
 * Analyzer input for a definition property that may resolve to source code.
 */
export interface SemanticSourceRefCandidate<
  TNode extends SemanticSyntaxNode = SemanticCompilerNode,
  TCall extends SemanticSyntaxNode = TNode,
  TExpression extends SemanticSyntaxNode = TNode,
> extends SemanticDefinitionCandidate<TNode, TCall> {
  readonly property: string;
  readonly role: ProjectSourceRefRole;
  readonly expression: TExpression;
  readonly metadata?: ProjectSourceRef["metadata"];
}

/**
 * TypeScript symbol resolution result with enough source data to emit refs.
 */
export interface SemanticResolvedSource<
  TExpression extends SemanticSyntaxNode = SemanticCompilerNode,
  TSourceFile extends SemanticSyntaxSourceFile = SemanticCompilerSourceFile,
  TDeclaration extends SemanticSyntaxNode = SemanticCompilerDeclaration,
> {
  readonly symbol: string;
  readonly sourceFile: TSourceFile;
  readonly declaration: TDeclaration;
  readonly expression?: TExpression;
  readonly functionName?: string;
}

/**
 * Index target resolved from a semantic expression.
 */
export interface SemanticTarget {
  readonly id: string;
  readonly kind: ProjectDefinitionKind;
}

/**
 * Additional definition, ref, and relation facts derived from one candidate.
 */
export interface SemanticDefinitionEnrichment {
  readonly definition: ProjectDefinition;
  readonly sourceRefs?: readonly ProjectSourceRef[];
  readonly relations?: readonly ProjectRelation[];
}

/**
 * Shared semantic analyzer context for candidate-level analyzers.
 */
export interface SemanticAnalyzerContext {
  /** Backend-neutral compiler view for source, symbol, and type queries. */
  readonly view: SemanticAnalyzerView;
}

/**
 * Resolved memory block metadata used to enrich authored memory definitions.
 */
export interface SemanticMemoryBlock<
  TObject extends SemanticSyntaxNode = SemanticCompilerNode,
  TExpression extends SemanticSyntaxNode = SemanticCompilerNode,
> {
  readonly id?: string;
  readonly kind?: string;
  readonly schema?: JsonSchema;
  readonly schemaExpression?: TExpression;
  readonly schemaResolved?: SemanticResolvedSource<TExpression>;
  readonly object: TObject;
}
