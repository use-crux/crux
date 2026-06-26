/**
 * Backend-neutral syntax access used by semantic analyzers.
 *
 * The syntax view is intentionally smaller than a TypeScript AST. Backends own
 * their concrete node objects, while Crux analyzers ask for normalized kinds,
 * traversal, source text, and the focused accessors they need to discover
 * definitions, schemas, source refs, and relations.
 *
 * @module
 */

/**
 * Normalized syntax kind understood by Crux semantic analyzers.
 *
 * Backends may expose richer native kinds internally. Values outside this
 * union should be reported as `unknown` until an analyzer needs a focused
 * accessor for them.
 */
export type SemanticSyntaxKind =
  | 'sourceFile'
  | 'identifier'
  | 'stringLiteral'
  | 'numericLiteral'
  | 'objectLiteral'
  | 'arrayLiteral'
  | 'propertyAssignment'
  | 'shorthandPropertyAssignment'
  | 'methodDeclaration'
  | 'callExpression'
  | 'newExpression'
  | 'propertyAccessExpression'
  | 'elementAccessExpression'
  | 'variableDeclaration'
  | 'variableStatement'
  | 'functionDeclaration'
  | 'functionExpression'
  | 'arrowFunction'
  | 'importDeclaration'
  | 'importSpecifier'
  | 'namespaceImport'
  | 'exportDeclaration'
  | 'classDeclaration'
  | 'interfaceDeclaration'
  | 'typeAliasDeclaration'
  | 'enumDeclaration'
  | 'parameter'
  | 'unknown'

/**
 * Opaque syntax node shape shared by backend-owned node handles.
 *
 * `kind` remains backend-native so TypeScript nodes can keep their numeric
 * `SyntaxKind` and native-preview nodes can keep their own enum. Use
 * `SemanticSyntaxView.kind()` for the normalized Crux kind.
 */
export interface SemanticSyntaxNode<TKind extends SemanticSyntaxKind = SemanticSyntaxKind> {
  /** Backend-native syntax kind. */
  readonly kind: string | number
  /** Start offset in the owning source file. */
  readonly pos: number
  /** End offset in the owning source file. */
  readonly end: number
  /** Phantom marker used by `isKind()` to preserve compile-time narrowing. */
  readonly semanticKind?: TKind
}

/**
 * Opaque source-file node with source text available to analyzers.
 */
export interface SemanticSyntaxSourceFile<TNode extends SemanticSyntaxNode = SemanticSyntaxNode>
  extends SemanticSyntaxNode {
  /** Absolute source file path. */
  readonly fileName: string
  /** Complete source text for this file. */
  readonly text: string
}

/**
 * Node type produced after a syntax view narrows a node to one Crux kind.
 */
export type SemanticSyntaxNodeOf<
  TNode extends SemanticSyntaxNode,
  TKind extends SemanticSyntaxKind,
> = TNode & SemanticSyntaxNode<TKind>

/**
 * Backend-neutral syntax operations consumed by semantic analyzers.
 *
 * Methods return backend-owned node handles or primitive values only. This
 * keeps shared analyzers independent from raw TypeScript and native-preview AST
 * APIs while still allowing each backend to implement exact syntax semantics.
 */
export interface SemanticSyntaxView<
  TNode extends SemanticSyntaxNode = SemanticSyntaxNode,
  TSourceFile extends TNode & SemanticSyntaxSourceFile<TNode> = TNode & SemanticSyntaxSourceFile<TNode>,
> {
  /** Return source files selected for semantic analysis. */
  sourceFiles(files: readonly string[]): readonly TSourceFile[]
  /** Return the source file that owns a node. */
  sourceFile(node: TNode): TSourceFile
  /** Return the parent node when the backend exposes one. */
  parent(node: TNode): TNode | undefined
  /** Return immediate semantic children for traversal. */
  children(node: TNode): readonly TNode[]
  /** Return exact source text for a node. */
  text(node: TNode): string
  /** Return the normalized Crux syntax kind for a node. */
  kind(node: TNode): SemanticSyntaxKind
  /** Narrow a backend-owned node to a normalized Crux syntax kind. */
  isKind<TKind extends SemanticSyntaxKind>(node: TNode, kind: TKind): node is SemanticSyntaxNodeOf<TNode, TKind>
  /** Return call arguments for a call expression, or an empty list. */
  callArguments(node: TNode): readonly TNode[]
  /** Return constructor arguments for a `new` expression, or an empty list. */
  newArguments(node: TNode): readonly TNode[]
  /** Return the simple helper name for a call or constructor expression. */
  callExpressionName(node: TNode): string | undefined
  /** Return the property name for a property access expression. */
  propertyAccessName(node: TNode): string | undefined
  /** Return the receiver expression for a property access expression. */
  propertyAccessExpression(node: TNode): TNode | undefined
  /** Return object literal members that can carry semantic values. */
  objectProperties(node: TNode): readonly TNode[]
  /** Return the name node for a property-like member. */
  propertyName(node: TNode): TNode | undefined
  /** Return the value expression represented by a property-like member. */
  propertyInitializer(node: TNode): TNode | undefined
  /** Return array literal elements. */
  arrayElements(node: TNode): readonly TNode[]
  /** Return identifier text. */
  identifierText(node: TNode): string | undefined
  /** Return string literal text without quotes. */
  stringLiteralText(node: TNode): string | undefined
  /** Return numeric literal text exactly as authored. */
  numericLiteralText(node: TNode): string | undefined
  /** Return the binding name for a variable declaration. */
  variableDeclarationName(node: TNode): TNode | undefined
  /** Return the initializer for a variable declaration. */
  variableDeclarationInitializer(node: TNode): TNode | undefined
  /** Return declarations carried by a variable statement. */
  variableStatementDeclarations(node: TNode): readonly TNode[]
  /** Return the module specifier text from an import declaration. */
  importModuleSpecifier(node: TNode): string | undefined
  /** Return named import specifiers from an import declaration. */
  namedImportSpecifiers(node: TNode): readonly TNode[]
  /** Return named export specifiers from an export declaration. */
  exportSpecifiers(node: TNode): readonly TNode[]
  /** Return the declared name node for named declarations. */
  declarationName(node: TNode): TNode | undefined
  /** Return whether a declaration has an `export` modifier. */
  hasExportModifier(node: TNode): boolean
  /** Return whether the node is a function-like declaration or expression. */
  isFunctionLike(node: TNode): boolean
}
