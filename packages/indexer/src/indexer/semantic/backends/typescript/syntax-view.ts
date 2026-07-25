import ts from "typescript";
import type {
  SemanticSyntaxNodeOf,
  SemanticSyntaxSourceFile,
  SemanticSyntaxView,
} from "../../syntax-view";
import { semanticSyntaxKindForTypeScriptNode } from "./syntax-kind";

export type TypeScriptSemanticSyntaxNode = ts.Node;
export type TypeScriptSemanticSyntaxSourceFile = ts.SourceFile &
  SemanticSyntaxSourceFile<TypeScriptSemanticSyntaxNode>;
export type TypeScriptSemanticSyntaxView = SemanticSyntaxView<
  TypeScriptSemanticSyntaxNode,
  TypeScriptSemanticSyntaxSourceFile
>;

export interface TypeScriptSemanticSyntaxViewInput {
  /** Return the TypeScript source files selected for semantic analysis. */
  readonly sourceFiles: (
    files: readonly string[],
  ) => readonly TypeScriptSemanticSyntaxSourceFile[];
}

/**
 * Creates a semantic syntax view backed by the JavaScript TypeScript compiler.
 *
 * This adapter keeps TypeScript-specific node checks inside the TypeScript
 * backend and exposes only Crux-owned syntax operations to shared analyzers.
 */
export function createTypeScriptSemanticSyntaxView(
  input: TypeScriptSemanticSyntaxViewInput,
): TypeScriptSemanticSyntaxView {
  return {
    sourceFiles(files) {
      return input.sourceFiles(files);
    },
    sourceFile(node) {
      return node.getSourceFile() as TypeScriptSemanticSyntaxSourceFile;
    },
    parent(node) {
      return node.parent;
    },
    children: childNodes,
    text(node) {
      return node.getText();
    },
    kind: semanticSyntaxKindForTypeScriptNode,
    isKind(
      node,
      kind,
    ): node is SemanticSyntaxNodeOf<TypeScriptSemanticSyntaxNode, typeof kind> {
      return semanticSyntaxKindForTypeScriptNode(node) === kind;
    },
    callArguments(node) {
      return ts.isCallExpression(node) ? [...node.arguments] : [];
    },
    callExpressionTarget(node) {
      return ts.isCallExpression(node) ? node.expression : undefined;
    },
    newArguments(node) {
      return ts.isNewExpression(node) ? [...(node.arguments ?? [])] : [];
    },
    callExpressionName,
    propertyAccessName(node) {
      return ts.isPropertyAccessExpression(node) ? node.name.text : undefined;
    },
    propertyAccessNameNode(node) {
      return ts.isPropertyAccessExpression(node) ? node.name : undefined;
    },
    propertyAccessExpression(node) {
      return ts.isPropertyAccessExpression(node) ? node.expression : undefined;
    },
    objectProperties(node) {
      return ts.isObjectLiteralExpression(node) ? [...node.properties] : [];
    },
    propertyName,
    propertyInitializer(node) {
      if (ts.isPropertyAssignment(node)) return node.initializer;
      if (ts.isShorthandPropertyAssignment(node)) return node.name;
      return undefined;
    },
    arrayElements(node) {
      return ts.isArrayLiteralExpression(node) ? [...node.elements] : [];
    },
    spreadExpression(node) {
      if (ts.isSpreadElement(node) || ts.isSpreadAssignment(node))
        return node.expression;
      return undefined;
    },
    logicalAndOperands(node) {
      return ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
        ? { left: node.left, right: node.right }
        : undefined;
    },
    templateExpressions(node) {
      return ts.isTemplateExpression(node)
        ? node.templateSpans.map((span) => span.expression)
        : [];
    },
    functionReturnExpressions: returnExpressions,
    promptTextReturnExpressions,
    taggedTemplateTag(node) {
      return ts.isTaggedTemplateExpression(node) ? node.tag : undefined;
    },
    taggedTemplateBody(node) {
      return ts.isTaggedTemplateExpression(node) ? node.template : undefined;
    },
    conditionalBranches(node) {
      return ts.isConditionalExpression(node)
        ? { whenTrue: node.whenTrue, whenFalse: node.whenFalse }
        : undefined;
    },
    literalValue,
    identifierText(node) {
      return ts.isIdentifier(node) ? node.text : undefined;
    },
    stringLiteralText(node) {
      return ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node)
        ? node.text
        : undefined;
    },
    numericLiteralText(node) {
      return ts.isNumericLiteral(node) ? node.text : undefined;
    },
    unwrapExpression,
    variableDeclarationName(node) {
      return ts.isVariableDeclaration(node) ? node.name : undefined;
    },
    variableDeclarationInitializer(node) {
      return ts.isVariableDeclaration(node) ? node.initializer : undefined;
    },
    variableDeclarationKind,
    variableStatementDeclarations(node) {
      return ts.isVariableStatement(node)
        ? [...node.declarationList.declarations]
        : [];
    },
    parameterTypeReference(node) {
      if (
        !ts.isParameter(node) ||
        !node.type ||
        !ts.isTypeReferenceNode(node.type)
      )
        return undefined;
      return ts.isIdentifier(node.type.typeName)
        ? {
            name: node.type.typeName.text,
            arguments: [...(node.type.typeArguments ?? [])],
          }
        : undefined;
    },
    importModuleSpecifier(node) {
      if (!ts.isImportDeclaration(node)) return undefined;
      return ts.isStringLiteral(node.moduleSpecifier)
        ? node.moduleSpecifier.text
        : undefined;
    },
    namedImportSpecifiers(node) {
      if (!ts.isImportDeclaration(node)) return [];
      const bindings = node.importClause?.namedBindings;
      return bindings && ts.isNamedImports(bindings)
        ? [...bindings.elements]
        : [];
    },
    namespaceImportName(node) {
      if (!ts.isImportDeclaration(node)) return undefined;
      const bindings = node.importClause?.namedBindings;
      return bindings && ts.isNamespaceImport(bindings)
        ? bindings.name.text
        : undefined;
    },
    exportSpecifiers(node) {
      if (
        !ts.isExportDeclaration(node) ||
        !node.exportClause ||
        !ts.isNamedExports(node.exportClause)
      )
        return [];
      return [...node.exportClause.elements];
    },
    declarationName,
    hasExportModifier(node) {
      return Boolean(
        ts.canHaveModifiers(node) &&
        ts
          .getModifiers(node)
          ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
      );
    },
    isFunctionLike(node) {
      return (
        ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node)
      );
    },
  };
}

function returnExpressions(node: ts.Node): readonly ts.Node[] {
  if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) return [node.body];
  const body =
    (ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node)) &&
    node.body &&
    ts.isBlock(node.body)
      ? node.body
      : undefined;
  if (!body) return [];
  return body.statements.flatMap((statement) =>
    ts.isReturnStatement(statement) && statement.expression
      ? [statement.expression]
      : [],
  );
}

function promptTextReturnExpressions(node: ts.Node): readonly ts.Node[] {
  if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) return [node.body];
  const body =
    (ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node)) &&
    node.body
      ? node.body
      : undefined;
  if (!body) return [];

  const expressions: ts.Expression[] = [];
  const visit = (current: ts.Node): void => {
    if (
      current !== body &&
      (ts.isFunctionLike(current) ||
        ts.isClassDeclaration(current) ||
        ts.isClassExpression(current))
    ) {
      return;
    }
    if (ts.isReturnStatement(current)) {
      if (current.expression) expressions.push(current.expression);
      return;
    }
    ts.forEachChild(current, visit);
  };
  visit(body);
  return expressions;
}

function literalValue(
  node: ts.Node,
): string | number | boolean | null | undefined {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  return undefined;
}

function unwrapExpression(node: ts.Node): ts.Node {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function variableDeclarationKind(
  node: ts.Node,
): "const" | "let" | "var" | undefined {
  if (!ts.isVariableDeclaration(node)) return undefined;
  const list = ts.isVariableDeclarationList(node.parent)
    ? node.parent
    : undefined;
  if (!list) return undefined;
  if (list.flags & ts.NodeFlags.Const) return "const";
  if (list.flags & ts.NodeFlags.Let) return "let";
  return "var";
}

function childNodes(node: ts.Node): readonly ts.Node[] {
  const children: ts.Node[] = [];
  ts.forEachChild(node, (child) => {
    children.push(child);
  });
  return children;
}

function callExpressionName(node: ts.Node): string | undefined {
  if (!ts.isCallExpression(node) && !ts.isNewExpression(node)) return undefined;
  if (ts.isIdentifier(node.expression)) return node.expression.text;
  if (ts.isPropertyAccessExpression(node.expression))
    return node.expression.name.text;
  return undefined;
}

function propertyName(node: ts.Node): ts.Node | undefined {
  if (
    ts.isPropertyAssignment(node) ||
    ts.isShorthandPropertyAssignment(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isPropertySignature(node)
  ) {
    return node.name;
  }
  if (ts.isImportSpecifier(node)) return node.propertyName ?? node.name;
  if (ts.isExportSpecifier(node)) return node.propertyName ?? node.name;
  return undefined;
}

function declarationName(node: ts.Node): ts.Node | undefined {
  if (
    ts.isVariableDeclaration(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isParameter(node)
  ) {
    return node.name;
  }
  return propertyName(node);
}
