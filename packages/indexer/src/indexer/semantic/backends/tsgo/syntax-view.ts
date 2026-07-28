/**
 * Native TypeScript-Go implementation of Crux semantic syntax access.
 *
 * The adapter keeps native-preview node checks inside the tsgo backend and
 * exposes only the backend-neutral syntax operations used by shared semantic
 * analyzers.
 *
 * @module
 */

import {
  ModifierFlags,
  NodeFlags,
  SyntaxKind,
  isArrayLiteralExpression,
  isArrowFunction,
  isAsExpression,
  isBinaryExpression,
  isBlock,
  isCallExpression,
  isClassDeclaration,
  isClassExpression,
  isConditionalExpression,
  isEnumDeclaration,
  isExportDeclaration,
  isExportSpecifier,
  isExpressionWithTypeArguments,
  isFalseLiteral,
  isFunctionDeclaration,
  isFunctionExpression,
  isIdentifier,
  isImportDeclaration,
  isImportSpecifier,
  isInterfaceDeclaration,
  isMethodDeclaration,
  isNamedExports,
  isNamedImports,
  isNamespaceImport,
  isNewExpression,
  isNoSubstitutionTemplateLiteral,
  isNonNullExpression,
  isNullLiteral,
  isNumericLiteral,
  isObjectLiteralExpression,
  isParenthesizedExpression,
  isPartiallyEmittedExpression,
  isParameterDeclaration,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isPropertyDeclaration,
  isPropertySignatureDeclaration,
  isReturnStatement,
  isSatisfiesExpression,
  isShorthandPropertyAssignment,
  isSpreadAssignment,
  isSpreadElement,
  isStringLiteral,
  isTemplateExpression,
  isTaggedTemplateExpression,
  isTypeReferenceNode,
  isTrueLiteral,
  isTypeAliasDeclaration,
  isTypeAssertion,
  isVariableDeclaration,
  isVariableStatement,
  type Node,
  type SourceFile,
} from "@typescript/native-preview/unstable/ast";
import type {
  SemanticSyntaxNodeOf,
  SemanticSyntaxSourceFile,
  SemanticSyntaxView,
} from "../../syntax-view";
import { nativeNodeList, nativeNodeText } from "./source";
import { semanticSyntaxKindForTsgoNode } from "./syntax-kind";

export type TsgoSemanticSyntaxNode = Node;
export type TsgoSemanticSyntaxSourceFile = SourceFile &
  SemanticSyntaxSourceFile<TsgoSemanticSyntaxNode>;
export type TsgoSemanticSyntaxView = SemanticSyntaxView<
  TsgoSemanticSyntaxNode,
  TsgoSemanticSyntaxSourceFile
>;

export interface TsgoSemanticSyntaxViewInput {
  /** Return native-preview source files selected for semantic analysis. */
  readonly sourceFiles: (
    files: readonly string[],
  ) => readonly TsgoSemanticSyntaxSourceFile[];
}

interface NodeWithModifierFlags extends Node {
  readonly modifierFlags: number;
}

/**
 * Creates a semantic syntax view backed by native-preview AST nodes.
 *
 * This is the native backend's shared analyzer view; it keeps raw
 * native-preview nodes behind the backend-neutral semantic syntax contract.
 */
export function createTsgoSemanticSyntaxView(
  input: TsgoSemanticSyntaxViewInput,
): TsgoSemanticSyntaxView {
  return {
    sourceFiles(files) {
      return input.sourceFiles(files);
    },
    sourceFile(node) {
      return node.getSourceFile() as TsgoSemanticSyntaxSourceFile;
    },
    parent(node) {
      return node.kind === SyntaxKind.SourceFile || node.parent === node
        ? undefined
        : node.parent;
    },
    children: childNodes,
    text(node) {
      return node.kind === SyntaxKind.SourceFile
        ? (node as SourceFile).text
        : nativeNodeText(node.getSourceFile(), node);
    },
    kind: semanticSyntaxKindForTsgoNode,
    isKind(
      node,
      kind,
    ): node is SemanticSyntaxNodeOf<TsgoSemanticSyntaxNode, typeof kind> {
      return semanticSyntaxKindForTsgoNode(node) === kind;
    },
    callArguments(node) {
      return isCallExpression(node) ? nativeNodeList(node.arguments) : [];
    },
    callExpressionTarget(node) {
      return isCallExpression(node) ? node.expression : undefined;
    },
    newArguments(node) {
      return isNewExpression(node) ? nativeNodeList(node.arguments ?? []) : [];
    },
    callExpressionName,
    propertyAccessName(node) {
      return isPropertyAccessExpression(node) ? node.name.text : undefined;
    },
    propertyAccessNameNode(node) {
      return isPropertyAccessExpression(node) ? node.name : undefined;
    },
    propertyAccessExpression(node) {
      return isPropertyAccessExpression(node) ? node.expression : undefined;
    },
    objectProperties(node) {
      return isObjectLiteralExpression(node)
        ? nativeNodeList(node.properties)
        : [];
    },
    propertyName,
    propertyInitializer(node) {
      if (isPropertyAssignment(node)) return node.initializer;
      if (isShorthandPropertyAssignment(node))
        return isIdentifier(node.name) ? node.name : undefined;
      return undefined;
    },
    isComputedProperty(node) {
      return (
        isPropertyAssignment(node) &&
        node.name.kind === SyntaxKind.ComputedPropertyName
      );
    },
    arrayElements(node) {
      return isArrayLiteralExpression(node)
        ? nativeNodeList(node.elements)
        : [];
    },
    spreadExpression(node) {
      if (isSpreadElement(node) || isSpreadAssignment(node))
        return node.expression;
      return undefined;
    },
    logicalAndOperands(node) {
      return isBinaryExpression(node) &&
        node.operatorToken.kind === SyntaxKind.AmpersandAmpersandToken
        ? { left: node.left, right: node.right }
        : undefined;
    },
    templateExpressions(node) {
      return isTemplateExpression(node)
        ? nativeNodeList(node.templateSpans).map((span) => span.expression)
        : [];
    },
    functionReturnExpressions: returnExpressions,
    promptTextReturnExpressions,
    taggedTemplateTag(node) {
      return isTaggedTemplateExpression(node) ? node.tag : undefined;
    },
    taggedTemplateBody(node) {
      return isTaggedTemplateExpression(node) ? node.template : undefined;
    },
    conditionalBranches(node) {
      return isConditionalExpression(node)
        ? { whenTrue: node.whenTrue, whenFalse: node.whenFalse }
        : undefined;
    },
    literalValue,
    identifierText(node) {
      return isIdentifier(node) ? node.text : undefined;
    },
    stringLiteralText(node) {
      return isStringLiteral(node) || isNoSubstitutionTemplateLiteral(node)
        ? node.text
        : undefined;
    },
    numericLiteralText(node) {
      return isNumericLiteral(node) ? node.text : undefined;
    },
    unwrapExpression,
    unwrapParentheses(node) {
      while (isParenthesizedExpression(node)) node = node.expression;
      return node;
    },
    variableDeclarationName(node) {
      return isVariableDeclaration(node) ? node.name : undefined;
    },
    variableDeclarationInitializer(node) {
      return isVariableDeclaration(node) ? node.initializer : undefined;
    },
    variableDeclarationKind,
    variableStatementDeclarations(node) {
      return isVariableStatement(node)
        ? nativeNodeList(node.declarationList.declarations)
        : [];
    },
    parameterTypeReference(node) {
      if (
        !isParameterDeclaration(node) ||
        !node.type ||
        !isTypeReferenceNode(node.type)
      )
        return undefined;
      return isIdentifier(node.type.typeName)
        ? {
            name: node.type.typeName.text,
            arguments: nativeNodeList(node.type.typeArguments ?? []),
          }
        : undefined;
    },
    importModuleSpecifier(node) {
      if (!isImportDeclaration(node)) return undefined;
      return isStringLiteral(node.moduleSpecifier)
        ? node.moduleSpecifier.text
        : undefined;
    },
    namedImportSpecifiers(node) {
      if (!isImportDeclaration(node)) return [];
      const bindings = node.importClause?.namedBindings;
      return bindings && isNamedImports(bindings)
        ? nativeNodeList(bindings.elements)
        : [];
    },
    namespaceImportName(node) {
      if (!isImportDeclaration(node)) return undefined;
      const bindings = node.importClause?.namedBindings;
      return bindings && isNamespaceImport(bindings)
        ? bindings.name.text
        : undefined;
    },
    exportSpecifiers(node) {
      if (
        !isExportDeclaration(node) ||
        !node.exportClause ||
        !isNamedExports(node.exportClause)
      )
        return [];
      return nativeNodeList(node.exportClause.elements);
    },
    declarationName,
    hasExportModifier(node) {
      return (
        hasModifierFlags(node) &&
        Boolean(node.modifierFlags & ModifierFlags.Export)
      );
    },
    isFunctionLike(node) {
      return (
        isFunctionDeclaration(node) ||
        isFunctionExpression(node) ||
        isArrowFunction(node) ||
        isMethodDeclaration(node)
      );
    },
  };
}

function childNodes(node: Node): readonly Node[] {
  const children: Node[] = [];
  node.forEachChild((child) => {
    children.push(child);
  });
  return children;
}

function callExpressionName(node: Node): string | undefined {
  if (!isCallExpression(node) && !isNewExpression(node)) return undefined;
  if (isIdentifier(node.expression)) return node.expression.text;
  if (isPropertyAccessExpression(node.expression))
    return node.expression.name.text;
  return undefined;
}

function propertyName(node: Node): Node | undefined {
  if (
    isPropertyAssignment(node) ||
    isShorthandPropertyAssignment(node) ||
    isMethodDeclaration(node) ||
    isPropertyDeclaration(node) ||
    isPropertySignatureDeclaration(node)
  ) {
    return node.name;
  }
  if (isImportSpecifier(node) || isExportSpecifier(node))
    return node.propertyName ?? node.name;
  return undefined;
}

function returnExpressions(node: Node): readonly Node[] {
  if (isArrowFunction(node) && !isBlock(node.body)) return [node.body];
  const body =
    (isArrowFunction(node) ||
      isFunctionExpression(node) ||
      isFunctionDeclaration(node) ||
      isMethodDeclaration(node)) &&
    node.body &&
    isBlock(node.body)
      ? node.body
      : undefined;
  if (!body) return [];
  return nativeNodeList(body.statements).flatMap((statement) =>
    isReturnStatement(statement) && statement.expression
      ? [statement.expression]
      : [],
  );
}

function promptTextReturnExpressions(node: Node): readonly Node[] {
  if (isArrowFunction(node) && !isBlock(node.body)) return [node.body];
  const body =
    (isArrowFunction(node) ||
      isFunctionExpression(node) ||
      isFunctionDeclaration(node) ||
      isMethodDeclaration(node)) &&
    node.body
      ? node.body
      : undefined;
  if (!body) return [];

  const expressions: Node[] = [];
  const visit = (current: Node): void => {
    if (
      current !== body &&
      (isFunctionDeclaration(current) ||
        isFunctionExpression(current) ||
        isArrowFunction(current) ||
        isMethodDeclaration(current) ||
        isClassDeclaration(current) ||
        isClassExpression(current) ||
        current.kind === SyntaxKind.GetAccessor ||
        current.kind === SyntaxKind.SetAccessor)
    ) {
      return;
    }
    if (isReturnStatement(current)) {
      if (current.expression) expressions.push(current.expression);
      return;
    }
    current.forEachChild(visit);
  };
  visit(body);
  return expressions;
}

function literalValue(
  node: Node,
): string | number | boolean | null | undefined {
  if (isStringLiteral(node) || isNoSubstitutionTemplateLiteral(node))
    return node.text;
  if (isNumericLiteral(node)) return Number(node.text);
  if (isTrueLiteral(node)) return true;
  if (isFalseLiteral(node)) return false;
  if (isNullLiteral(node)) return null;
  return undefined;
}

function unwrapExpression(node: Node): Node {
  let current = node;
  while (
    isParenthesizedExpression(current) ||
    isAsExpression(current) ||
    isSatisfiesExpression(current) ||
    isTypeAssertion(current) ||
    isNonNullExpression(current) ||
    isExpressionWithTypeArguments(current) ||
    isPartiallyEmittedExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function variableDeclarationKind(
  node: Node,
): "const" | "let" | "var" | undefined {
  if (!isVariableDeclaration(node)) return undefined;
  const list =
    node.parent?.kind === SyntaxKind.VariableDeclarationList
      ? node.parent
      : undefined;
  if (!list || !("flags" in list) || typeof list.flags !== "number") {
    return undefined;
  }
  if (list.flags & NodeFlags.Const) return "const";
  if (list.flags & NodeFlags.Let) return "let";
  return "var";
}

function declarationName(node: Node): Node | undefined {
  if (
    isVariableDeclaration(node) ||
    isFunctionDeclaration(node) ||
    isFunctionExpression(node) ||
    isClassDeclaration(node) ||
    isInterfaceDeclaration(node) ||
    isTypeAliasDeclaration(node) ||
    isEnumDeclaration(node)
  ) {
    return node.name;
  }
  return propertyName(node);
}

function hasModifierFlags(node: Node): node is NodeWithModifierFlags {
  return (
    typeof (node as Partial<NodeWithModifierFlags>).modifierFlags === "number"
  );
}
