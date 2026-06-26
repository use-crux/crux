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
  SyntaxKind,
  isArrayLiteralExpression,
  isArrowFunction,
  isAsExpression,
  isBinaryExpression,
  isBlock,
  isCallExpression,
  isClassDeclaration,
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
  isTrueLiteral,
  isTypeAliasDeclaration,
  isTypeAssertion,
  isVariableDeclaration,
  isVariableStatement,
  type Expression,
  type Node,
  type SourceFile,
} from '@typescript/native-preview/unstable/ast'
import type {
  SemanticSyntaxNodeOf,
  SemanticSyntaxSourceFile,
  SemanticSyntaxView,
} from '../../syntax-view'
import { nativeNodeList, nativeNodeText } from './source'
import { semanticSyntaxKindForTsgoNode } from './syntax-kind'

export type TsgoSemanticSyntaxNode = Node
export type TsgoSemanticSyntaxSourceFile = SourceFile & SemanticSyntaxSourceFile<TsgoSemanticSyntaxNode>
export type TsgoSemanticSyntaxView = SemanticSyntaxView<TsgoSemanticSyntaxNode, TsgoSemanticSyntaxSourceFile>

export interface TsgoSemanticSyntaxViewInput {
  /** Return native-preview source files selected for semantic analysis. */
  readonly sourceFiles: (files: readonly string[]) => readonly TsgoSemanticSyntaxSourceFile[]
}

interface NodeWithModifierFlags extends Node {
  readonly modifierFlags: number
}

/**
 * Creates a semantic syntax view backed by native-preview AST nodes.
 *
 * The old TypeScript AST facade remains wired until Phase 5. This factory is
 * intentionally independent so tests can prove the native adapter before the
 * shared analyzer switches to it.
 */
export function createTsgoSemanticSyntaxView(input: TsgoSemanticSyntaxViewInput): TsgoSemanticSyntaxView {
  return {
    sourceFiles(files) {
      return input.sourceFiles(files)
    },
    sourceFile(node) {
      return node.getSourceFile() as TsgoSemanticSyntaxSourceFile
    },
    parent(node) {
      return node.kind === SyntaxKind.SourceFile || node.parent === node ? undefined : node.parent
    },
    children: childNodes,
    text(node) {
      return node.kind === SyntaxKind.SourceFile ? (node as SourceFile).text : nativeNodeText(node.getSourceFile(), node)
    },
    kind: semanticSyntaxKindForTsgoNode,
    isKind(node, kind): node is SemanticSyntaxNodeOf<TsgoSemanticSyntaxNode, typeof kind> {
      return semanticSyntaxKindForTsgoNode(node) === kind
    },
    callArguments(node) {
      return isCallExpression(node) ? nativeNodeList(node.arguments) : []
    },
    callExpressionTarget(node) {
      return isCallExpression(node) ? node.expression : undefined
    },
    newArguments(node) {
      return isNewExpression(node) ? nativeNodeList(node.arguments ?? []) : []
    },
    callExpressionName,
    propertyAccessName(node) {
      return isPropertyAccessExpression(node) ? node.name.text : undefined
    },
    propertyAccessNameNode(node) {
      return isPropertyAccessExpression(node) ? node.name : undefined
    },
    propertyAccessExpression(node) {
      return isPropertyAccessExpression(node) ? node.expression : undefined
    },
    objectProperties(node) {
      return isObjectLiteralExpression(node) ? nativeNodeList(node.properties) : []
    },
    propertyName,
    propertyInitializer(node) {
      if (isPropertyAssignment(node)) return node.initializer
      if (isShorthandPropertyAssignment(node)) return isIdentifier(node.name) ? node.name : undefined
      return undefined
    },
    arrayElements(node) {
      return isArrayLiteralExpression(node) ? nativeNodeList(node.elements) : []
    },
    spreadExpression(node) {
      if (isSpreadElement(node) || isSpreadAssignment(node)) return node.expression
      return undefined
    },
    logicalAndOperands(node) {
      return isBinaryExpression(node) && node.operatorToken.kind === SyntaxKind.AmpersandAmpersandToken
        ? { left: node.left, right: node.right }
        : undefined
    },
    templateExpressions(node) {
      return isTemplateExpression(node) ? nativeNodeList(node.templateSpans).map((span) => span.expression) : []
    },
    functionReturnExpressions: returnExpressions,
    literalValue,
    identifierText(node) {
      return isIdentifier(node) ? node.text : undefined
    },
    stringLiteralText(node) {
      return isStringLiteral(node) || isNoSubstitutionTemplateLiteral(node) ? node.text : undefined
    },
    numericLiteralText(node) {
      return isNumericLiteral(node) ? node.text : undefined
    },
    unwrapExpression,
    variableDeclarationName(node) {
      return isVariableDeclaration(node) ? node.name : undefined
    },
    variableDeclarationInitializer(node) {
      return isVariableDeclaration(node) ? node.initializer : undefined
    },
    variableStatementDeclarations(node) {
      return isVariableStatement(node) ? nativeNodeList(node.declarationList.declarations) : []
    },
    importModuleSpecifier(node) {
      if (!isImportDeclaration(node)) return undefined
      return isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : undefined
    },
    namedImportSpecifiers(node) {
      if (!isImportDeclaration(node)) return []
      const bindings = node.importClause?.namedBindings
      return bindings && isNamedImports(bindings) ? nativeNodeList(bindings.elements) : []
    },
    namespaceImportName(node) {
      if (!isImportDeclaration(node)) return undefined
      const bindings = node.importClause?.namedBindings
      return bindings && isNamespaceImport(bindings) ? bindings.name.text : undefined
    },
    exportSpecifiers(node) {
      if (!isExportDeclaration(node) || !node.exportClause || !isNamedExports(node.exportClause)) return []
      return nativeNodeList(node.exportClause.elements)
    },
    declarationName,
    hasExportModifier(node) {
      return hasModifierFlags(node) && Boolean(node.modifierFlags & ModifierFlags.Export)
    },
    isFunctionLike(node) {
      return isFunctionDeclaration(node) || isFunctionExpression(node) || isArrowFunction(node) || isMethodDeclaration(node)
    },
  }
}

function childNodes(node: Node): readonly Node[] {
  const children: Node[] = []
  node.forEachChild((child) => {
    children.push(child)
  })
  return children
}

function callExpressionName(node: Node): string | undefined {
  if (!isCallExpression(node) && !isNewExpression(node)) return undefined
  if (isIdentifier(node.expression)) return node.expression.text
  if (isPropertyAccessExpression(node.expression)) return node.expression.name.text
  return undefined
}

function propertyName(node: Node): Node | undefined {
  if (
    isPropertyAssignment(node) ||
    isShorthandPropertyAssignment(node) ||
    isMethodDeclaration(node) ||
    isPropertyDeclaration(node) ||
    isPropertySignatureDeclaration(node)
  ) {
    return node.name
  }
  if (isImportSpecifier(node) || isExportSpecifier(node)) return node.propertyName ?? node.name
  return undefined
}

function returnExpressions(node: Node): readonly Node[] {
  if (isArrowFunction(node) && !isBlock(node.body)) return [node.body]
  const body =
    (isArrowFunction(node) || isFunctionExpression(node) || isFunctionDeclaration(node) || isMethodDeclaration(node)) &&
    node.body &&
    isBlock(node.body)
      ? node.body
      : undefined
  if (!body) return []
  return nativeNodeList(body.statements).flatMap((statement) =>
    isReturnStatement(statement) && statement.expression ? [statement.expression] : [],
  )
}

function literalValue(node: Node): string | number | boolean | null | undefined {
  if (isStringLiteral(node) || isNoSubstitutionTemplateLiteral(node)) return node.text
  if (isNumericLiteral(node)) return Number(node.text)
  if (isTrueLiteral(node)) return true
  if (isFalseLiteral(node)) return false
  if (isNullLiteral(node)) return null
  return undefined
}

function unwrapExpression(node: Node): Node {
  let current = node
  while (
    isParenthesizedExpression(current) ||
    isAsExpression(current) ||
    isSatisfiesExpression(current) ||
    isTypeAssertion(current) ||
    isNonNullExpression(current) ||
    isExpressionWithTypeArguments(current) ||
    isPartiallyEmittedExpression(current)
  ) {
    current = current.expression
  }
  return current
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
    return node.name
  }
  return propertyName(node)
}

function hasModifierFlags(node: Node): node is NodeWithModifierFlags {
  return typeof (node as Partial<NodeWithModifierFlags>).modifierFlags === 'number'
}
