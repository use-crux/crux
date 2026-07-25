import { SyntaxKind, type Node } from "@typescript/native-preview/unstable/ast";
import type { SemanticSyntaxKind } from "../../syntax-view";

/**
 * Converts a native-preview syntax kind into the normalized Crux syntax kind
 * consumed by backend-neutral semantic analyzers.
 */
export function semanticSyntaxKindForTsgoNode(node: Node): SemanticSyntaxKind {
  switch (node.kind) {
    case SyntaxKind.SourceFile:
      return "sourceFile";
    case SyntaxKind.Identifier:
      return "identifier";
    case SyntaxKind.StringLiteral:
    case SyntaxKind.NoSubstitutionTemplateLiteral:
      return "stringLiteral";
    case SyntaxKind.NumericLiteral:
      return "numericLiteral";
    case SyntaxKind.ObjectLiteralExpression:
      return "objectLiteral";
    case SyntaxKind.ArrayLiteralExpression:
      return "arrayLiteral";
    case SyntaxKind.PropertyAssignment:
      return "propertyAssignment";
    case SyntaxKind.ShorthandPropertyAssignment:
      return "shorthandPropertyAssignment";
    case SyntaxKind.MethodDeclaration:
      return "methodDeclaration";
    case SyntaxKind.TaggedTemplateExpression:
      return "taggedTemplate";
    case SyntaxKind.CallExpression:
      return "callExpression";
    case SyntaxKind.NewExpression:
      return "newExpression";
    case SyntaxKind.PropertyAccessExpression:
      return "propertyAccessExpression";
    case SyntaxKind.ElementAccessExpression:
      return "elementAccessExpression";
    case SyntaxKind.VariableDeclaration:
      return "variableDeclaration";
    case SyntaxKind.VariableStatement:
      return "variableStatement";
    case SyntaxKind.FunctionDeclaration:
      return "functionDeclaration";
    case SyntaxKind.FunctionExpression:
      return "functionExpression";
    case SyntaxKind.ArrowFunction:
      return "arrowFunction";
    case SyntaxKind.ImportDeclaration:
      return "importDeclaration";
    case SyntaxKind.ImportSpecifier:
      return "importSpecifier";
    case SyntaxKind.NamespaceImport:
      return "namespaceImport";
    case SyntaxKind.ExportDeclaration:
      return "exportDeclaration";
    case SyntaxKind.ClassDeclaration:
      return "classDeclaration";
    case SyntaxKind.InterfaceDeclaration:
      return "interfaceDeclaration";
    case SyntaxKind.TypeAliasDeclaration:
      return "typeAliasDeclaration";
    case SyntaxKind.EnumDeclaration:
      return "enumDeclaration";
    case SyntaxKind.Parameter:
      return "parameter";
    default:
      return "unknown";
  }
}
