import ts from 'typescript'
import type {
  SemanticSyntaxNodeOf,
  SemanticSyntaxSourceFile,
  SemanticSyntaxView,
} from '../../syntax-view'
import { semanticSyntaxKindForTypeScriptNode } from './syntax-kind'

export type TypeScriptSemanticSyntaxNode = ts.Node
export type TypeScriptSemanticSyntaxSourceFile = ts.SourceFile &
  SemanticSyntaxSourceFile<TypeScriptSemanticSyntaxNode>
export type TypeScriptSemanticSyntaxView = SemanticSyntaxView<
  TypeScriptSemanticSyntaxNode,
  TypeScriptSemanticSyntaxSourceFile
>

export interface TypeScriptSemanticSyntaxViewInput {
  /** Return the TypeScript source files selected for semantic analysis. */
  readonly sourceFiles: (files: readonly string[]) => readonly TypeScriptSemanticSyntaxSourceFile[]
}

/**
 * Creates a semantic syntax view backed by the JavaScript TypeScript compiler.
 *
 * This adapter keeps TypeScript-specific node checks inside the TypeScript
 * backend and exposes only Crux-owned syntax operations to shared analyzers.
 */
export function createTypeScriptSemanticSyntaxView(input: TypeScriptSemanticSyntaxViewInput): TypeScriptSemanticSyntaxView {
  return {
    sourceFiles(files) {
      return input.sourceFiles(files)
    },
    sourceFile(node) {
      return node.getSourceFile() as TypeScriptSemanticSyntaxSourceFile
    },
    parent(node) {
      return node.parent
    },
    children: childNodes,
    text(node) {
      return node.getText()
    },
    kind: semanticSyntaxKindForTypeScriptNode,
    isKind(node, kind): node is SemanticSyntaxNodeOf<TypeScriptSemanticSyntaxNode, typeof kind> {
      return semanticSyntaxKindForTypeScriptNode(node) === kind
    },
    callArguments(node) {
      return ts.isCallExpression(node) ? [...node.arguments] : []
    },
    newArguments(node) {
      return ts.isNewExpression(node) ? [...(node.arguments ?? [])] : []
    },
    callExpressionName,
    propertyAccessName(node) {
      return ts.isPropertyAccessExpression(node) ? node.name.text : undefined
    },
    propertyAccessExpression(node) {
      return ts.isPropertyAccessExpression(node) ? node.expression : undefined
    },
    objectProperties(node) {
      return ts.isObjectLiteralExpression(node) ? [...node.properties] : []
    },
    propertyName,
    propertyInitializer(node) {
      if (ts.isPropertyAssignment(node)) return node.initializer
      if (ts.isShorthandPropertyAssignment(node)) return node.name
      return undefined
    },
    arrayElements(node) {
      return ts.isArrayLiteralExpression(node) ? [...node.elements] : []
    },
    identifierText(node) {
      return ts.isIdentifier(node) ? node.text : undefined
    },
    stringLiteralText(node) {
      return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : undefined
    },
    numericLiteralText(node) {
      return ts.isNumericLiteral(node) ? node.text : undefined
    },
    variableDeclarationName(node) {
      return ts.isVariableDeclaration(node) ? node.name : undefined
    },
    variableDeclarationInitializer(node) {
      return ts.isVariableDeclaration(node) ? node.initializer : undefined
    },
    variableStatementDeclarations(node) {
      return ts.isVariableStatement(node) ? [...node.declarationList.declarations] : []
    },
    importModuleSpecifier(node) {
      if (!ts.isImportDeclaration(node)) return undefined
      return ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : undefined
    },
    namedImportSpecifiers(node) {
      if (!ts.isImportDeclaration(node)) return []
      const bindings = node.importClause?.namedBindings
      return bindings && ts.isNamedImports(bindings) ? [...bindings.elements] : []
    },
    exportSpecifiers(node) {
      if (!ts.isExportDeclaration(node) || !node.exportClause || !ts.isNamedExports(node.exportClause)) return []
      return [...node.exportClause.elements]
    },
    declarationName,
    hasExportModifier(node) {
      return Boolean(
        ts.canHaveModifiers(node) &&
          ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
      )
    },
    isFunctionLike(node) {
      return (
        ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node)
      )
    },
  }
}

function childNodes(node: ts.Node): readonly ts.Node[] {
  const children: ts.Node[] = []
  ts.forEachChild(node, (child) => {
    children.push(child)
  })
  return children
}

function callExpressionName(node: ts.Node): string | undefined {
  if (!ts.isCallExpression(node) && !ts.isNewExpression(node)) return undefined
  if (ts.isIdentifier(node.expression)) return node.expression.text
  if (ts.isPropertyAccessExpression(node.expression)) return node.expression.name.text
  return undefined
}

function propertyName(node: ts.Node): ts.Node | undefined {
  if (
    ts.isPropertyAssignment(node) ||
    ts.isShorthandPropertyAssignment(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isPropertySignature(node)
  ) {
    return node.name
  }
  if (ts.isImportSpecifier(node)) return node.propertyName ?? node.name
  if (ts.isExportSpecifier(node)) return node.propertyName ?? node.name
  return undefined
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
    return node.name
  }
  return propertyName(node)
}
