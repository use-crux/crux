import ts from 'typescript'
import type { SemanticSyntaxKind } from '../../syntax-view'

/**
 * Converts a TypeScript compiler syntax kind into the normalized Crux syntax
 * kind consumed by backend-neutral semantic analyzers.
 */
export function semanticSyntaxKindForTypeScriptNode(node: ts.Node): SemanticSyntaxKind {
  switch (node.kind) {
    case ts.SyntaxKind.SourceFile:
      return 'sourceFile'
    case ts.SyntaxKind.Identifier:
      return 'identifier'
    case ts.SyntaxKind.StringLiteral:
    case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
      return 'stringLiteral'
    case ts.SyntaxKind.NumericLiteral:
      return 'numericLiteral'
    case ts.SyntaxKind.ObjectLiteralExpression:
      return 'objectLiteral'
    case ts.SyntaxKind.ArrayLiteralExpression:
      return 'arrayLiteral'
    case ts.SyntaxKind.PropertyAssignment:
      return 'propertyAssignment'
    case ts.SyntaxKind.ShorthandPropertyAssignment:
      return 'shorthandPropertyAssignment'
    case ts.SyntaxKind.MethodDeclaration:
      return 'methodDeclaration'
    case ts.SyntaxKind.CallExpression:
      return 'callExpression'
    case ts.SyntaxKind.NewExpression:
      return 'newExpression'
    case ts.SyntaxKind.PropertyAccessExpression:
      return 'propertyAccessExpression'
    case ts.SyntaxKind.ElementAccessExpression:
      return 'elementAccessExpression'
    case ts.SyntaxKind.VariableDeclaration:
      return 'variableDeclaration'
    case ts.SyntaxKind.VariableStatement:
      return 'variableStatement'
    case ts.SyntaxKind.FunctionDeclaration:
      return 'functionDeclaration'
    case ts.SyntaxKind.FunctionExpression:
      return 'functionExpression'
    case ts.SyntaxKind.ArrowFunction:
      return 'arrowFunction'
    case ts.SyntaxKind.ImportDeclaration:
      return 'importDeclaration'
    case ts.SyntaxKind.ImportSpecifier:
      return 'importSpecifier'
    case ts.SyntaxKind.NamespaceImport:
      return 'namespaceImport'
    case ts.SyntaxKind.ExportDeclaration:
      return 'exportDeclaration'
    case ts.SyntaxKind.ClassDeclaration:
      return 'classDeclaration'
    case ts.SyntaxKind.InterfaceDeclaration:
      return 'interfaceDeclaration'
    case ts.SyntaxKind.TypeAliasDeclaration:
      return 'typeAliasDeclaration'
    case ts.SyntaxKind.EnumDeclaration:
      return 'enumDeclaration'
    case ts.SyntaxKind.Parameter:
      return 'parameter'
    default:
      return 'unknown'
  }
}
