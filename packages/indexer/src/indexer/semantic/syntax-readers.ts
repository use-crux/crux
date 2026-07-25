import { extname } from "node:path";
import type {
  SourceLocation,
  SourceSnippet,
} from "@use-crux/core/project-index";
import type {
  SemanticSyntaxNode,
  SemanticSyntaxSourceFile,
  SemanticSyntaxView,
} from "./syntax-view";

const MAX_SNIPPET_LENGTH = 12_000;

/**
 * Reads a stable, backend-neutral key for a node source span.
 */
export function semanticNodeKey<
  TNode extends SemanticSyntaxNode,
  TSourceFile extends TNode & SemanticSyntaxSourceFile<TNode>,
>(node: TNode, syntax: SemanticSyntaxView<TNode, TSourceFile>): string {
  const sourceFile = syntax.sourceFile(node);
  return `${sourceFile.fileName}:${node.pos}:${node.end}`;
}

/**
 * Returns the source location for a backend-owned syntax node.
 */
export function semanticSourceForNode<
  TNode extends SemanticSyntaxNode,
  TSourceFile extends TNode & SemanticSyntaxSourceFile<TNode>,
>(node: TNode, syntax: SemanticSyntaxView<TNode, TSourceFile>): SourceLocation {
  const sourceFile = syntax.sourceFile(node);
  const position = lineAndColumn(
    sourceFile.text,
    semanticNodeStart(sourceFile.text, node),
  );
  return {
    file: sourceFile.fileName,
    line: position.line,
    column: position.column,
  };
}

/**
 * Returns a source snippet for a backend-owned syntax node.
 */
export function semanticSourceSnippetForNode<
  TNode extends SemanticSyntaxNode,
  TSourceFile extends TNode & SemanticSyntaxSourceFile<TNode>,
>(node: TNode, syntax: SemanticSyntaxView<TNode, TSourceFile>): SourceSnippet {
  const sourceFile = syntax.sourceFile(node);
  const source = syntax.text(node);
  const snippet =
    source.length > MAX_SNIPPET_LENGTH
      ? source.slice(0, MAX_SNIPPET_LENGTH)
      : source;
  const start = lineAndColumn(
    sourceFile.text,
    semanticNodeStart(sourceFile.text, node),
  );
  const end = lineAndColumn(sourceFile.text, node.end);
  return {
    source: snippet,
    language: languageForFile(sourceFile.fileName),
    range: {
      file: sourceFile.fileName,
      startLine: start.line,
      startColumn: start.column,
      endLine: end.line,
      endColumn: end.column,
    },
    truncated: source.length > MAX_SNIPPET_LENGTH,
  };
}

/**
 * Returns complete authored node text for semantic contracts requiring exact
 * source evidence rather than a bounded diagnostic preview.
 */
export function semanticExactSourceSnippetForNode<
  TNode extends SemanticSyntaxNode,
  TSourceFile extends TNode & SemanticSyntaxSourceFile<TNode>,
>(node: TNode, syntax: SemanticSyntaxView<TNode, TSourceFile>): SourceSnippet {
  const sourceFile = syntax.sourceFile(node);
  const start = lineAndColumn(
    sourceFile.text,
    semanticNodeStart(sourceFile.text, node),
  );
  const end = lineAndColumn(sourceFile.text, node.end);
  return {
    source: syntax.text(node),
    language: languageForFile(sourceFile.fileName),
    range: {
      file: sourceFile.fileName,
      startLine: start.line,
      startColumn: start.column,
      endLine: end.line,
      endColumn: end.column,
    },
    truncated: false,
  };
}

/**
 * Returns the static name represented by an identifier or literal name node.
 */
export function semanticNodeName<
  TNode extends SemanticSyntaxNode,
  TSourceFile extends TNode & SemanticSyntaxSourceFile<TNode>,
>(
  node: TNode,
  syntax: SemanticSyntaxView<TNode, TSourceFile>,
): string | undefined {
  return (
    syntax.identifierText(node) ??
    syntax.stringLiteralText(node) ??
    syntax.numericLiteralText(node)
  );
}

/**
 * Returns the static name for a property-like syntax node.
 */
export function semanticPropertyName<
  TNode extends SemanticSyntaxNode,
  TSourceFile extends TNode & SemanticSyntaxSourceFile<TNode>,
>(
  property: TNode,
  syntax: SemanticSyntaxView<TNode, TSourceFile>,
): string | undefined {
  const name = syntax.propertyName(property);
  return name ? semanticNodeName(name, syntax) : undefined;
}

/**
 * Returns the value expression for a named object-literal property.
 */
export function semanticPropertyInitializer<
  TNode extends SemanticSyntaxNode,
  TSourceFile extends TNode & SemanticSyntaxSourceFile<TNode>,
>(
  object: TNode,
  name: string,
  syntax: SemanticSyntaxView<TNode, TSourceFile>,
): TNode | undefined {
  const property = syntax
    .objectProperties(object)
    .find((item) => semanticPropertyName(item, syntax) === name);
  return property ? syntax.propertyInitializer(property) : undefined;
}

/**
 * Reads a string-literal property after unwrapping harmless syntax wrappers.
 */
export function semanticStringLiteralProperty<
  TNode extends SemanticSyntaxNode,
  TSourceFile extends TNode & SemanticSyntaxSourceFile<TNode>,
>(
  object: TNode,
  name: string,
  syntax: SemanticSyntaxView<TNode, TSourceFile>,
): string | undefined {
  const initializer = semanticPropertyInitializer(object, name, syntax);
  return initializer
    ? syntax.stringLiteralText(syntax.unwrapExpression(initializer))
    : undefined;
}

/**
 * Returns whether an expression can be resolved through compiler symbols.
 */
export function semanticIsResolvableSourceExpression<
  TNode extends SemanticSyntaxNode,
  TSourceFile extends TNode & SemanticSyntaxSourceFile<TNode>,
>(expression: TNode, syntax: SemanticSyntaxView<TNode, TSourceFile>): boolean {
  const unwrapped = syntax.unwrapExpression(expression);
  return (
    syntax.isKind(unwrapped, "identifier") ||
    syntax.isKind(unwrapped, "propertyAccessExpression")
  );
}

/**
 * Infers the authored variable or property name associated with a node.
 */
export function semanticVariableNameForNode<
  TNode extends SemanticSyntaxNode,
  TSourceFile extends TNode & SemanticSyntaxSourceFile<TNode>,
>(
  node: TNode,
  syntax: SemanticSyntaxView<TNode, TSourceFile>,
): string | undefined {
  const parent = syntax.parent(node);
  if (!parent) return undefined;
  if (syntax.isKind(parent, "variableDeclaration")) {
    const name = syntax.variableDeclarationName(parent);
    return name ? semanticNodeName(name, syntax) : undefined;
  }
  if (
    syntax.isKind(parent, "propertyAssignment") ||
    syntax.isKind(parent, "shorthandPropertyAssignment")
  ) {
    return semanticPropertyName(parent, syntax);
  }
  return undefined;
}

function lineAndColumn(
  text: string,
  offset: number,
): { line: number; column: number } {
  const bounded = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  let column = 1;
  for (let index = 0; index < bounded; index += 1) {
    if (text.charCodeAt(index) === 10) {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

function semanticNodeStart(text: string, node: SemanticSyntaxNode): number {
  return skipTrivia(text, node.pos);
}

function skipTrivia(text: string, start: number): number {
  let index = Math.max(0, Math.min(start, text.length));
  while (index < text.length) {
    const char = text.charCodeAt(index);
    if (char === 32 || char === 9 || char === 10 || char === 13) {
      index += 1;
      continue;
    }
    if (text.startsWith("//", index)) {
      const nextLine = text.indexOf("\n", index + 2);
      index = nextLine === -1 ? text.length : nextLine + 1;
      continue;
    }
    if (text.startsWith("/*", index)) {
      const end = text.indexOf("*/", index + 2);
      index = end === -1 ? text.length : end + 2;
      continue;
    }
    return index;
  }
  return index;
}

function languageForFile(file: string): string | undefined {
  switch (extname(file)) {
    case ".ts":
    case ".tsx":
      return "typescript";
    case ".js":
    case ".mjs":
    case ".cjs":
      return "javascript";
    case ".json":
      return "json";
    default:
      return undefined;
  }
}
