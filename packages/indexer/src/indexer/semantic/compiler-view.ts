import type { SemanticBackendIdentity } from "./service/types";
import type {
  SemanticSyntaxNode,
  SemanticSyntaxSourceFile,
  SemanticSyntaxView,
} from "./syntax-view";

/**
 * Opaque compiler node shape used by backend-neutral semantic views.
 *
 * Backends may wrap TypeScript AST nodes, TypeScript-Go remote nodes, or
 * future native handles. Consumers should treat nodes as view-owned values.
 */
export interface SemanticCompilerNode extends SemanticSyntaxNode {
  /** Numeric or string syntax kind owned by the backend. */
  readonly kind: string | number;
  /** Start offset in the owning source file. */
  readonly pos: number;
  /** End offset in the owning source file. */
  readonly end: number;
}

/**
 * Opaque compiler source file node.
 */
export interface SemanticCompilerSourceFile
  extends
    SemanticCompilerNode,
    SemanticSyntaxSourceFile<SemanticCompilerNode> {}

/**
 * Opaque compiler declaration node.
 */
export interface SemanticCompilerDeclaration extends SemanticCompilerNode {}

/**
 * Opaque compiler symbol handle.
 */
export interface SemanticCompilerSymbol {
  /** Backend-provided symbol display name. */
  readonly name: string;
}

/**
 * Opaque compiler type handle.
 */
export interface SemanticCompilerType {
  /** Backend-provided type flags. */
  readonly flags: number;
}

/** Canonical package export identity proven by a compiler backend. */
export interface SemanticCanonicalExportIdentity {
  readonly module: string;
  readonly export: string;
}

/**
 * Backend-neutral compiler view used by semantic analyzers.
 *
 * Operations are intentionally batch-shaped where symbol/type resolution may
 * cross an IPC boundary. In-process TypeScript can implement these with simple
 * maps, while TypeScript-Go can forward arrays to its native API.
 */
export interface SemanticCompilerView<
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
> {
  /** Compiler backend that owns this view. */
  readonly identity: SemanticBackendIdentity;
  /** Backend-neutral syntax access paired with this compiler view. */
  readonly syntax: SemanticSyntaxView<TNode, TSourceFile>;
  /** Return source files selected for semantic analysis. */
  sourceFiles(files: readonly string[]): readonly TSourceFile[];
  /** Return the source file that owns a node. */
  sourceFile(node: TNode): TSourceFile;
  /** Return exact source text for a node. */
  sourceText(node: TNode): string;
  /** Return immediate compiler children for a node. */
  childNodes(node: TNode): readonly TNode[];
  /** Resolve symbols for nodes in a single backend operation. */
  symbolsAt(nodes: readonly TNode[]): readonly (TSymbol | undefined)[];
  /** Resolve alias-aware symbols for nodes in a single backend operation. */
  resolvedSymbols(nodes: readonly TNode[]): readonly (TSymbol | undefined)[];
  /** Resolve shorthand assignment value symbols in a single backend operation. */
  shorthandAssignmentValueSymbols(
    nodes: readonly TNode[],
  ): readonly (TSymbol | undefined)[];
  /** Resolve types for nodes in a single backend operation. */
  typesAt(nodes: readonly TNode[]): readonly (TType | undefined)[];
  /** Render type display strings in a single backend operation. */
  typeStrings(types: readonly TType[], enclosing?: TNode): readonly string[];
  /** Return declarations for symbols in a single backend operation. */
  declarationsOf(
    symbols: readonly TSymbol[],
  ): readonly (readonly TDeclaration[])[];
  /**
   * Prove that an expression resolves to one exact package-root value export.
   *
   * Backends must use their active compiler program and fail closed when
   * lexical binding, package resolution, or export identity is ambiguous.
   */
  canonicalExportIdentity(
    node: TNode,
    moduleName: string,
    exportName: string,
  ): SemanticCanonicalExportIdentity | undefined;
}
