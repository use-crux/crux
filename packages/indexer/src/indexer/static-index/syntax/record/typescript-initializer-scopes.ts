import ts from "typescript";

/** A TypeScript statement container with an Oxc lexical-scope counterpart. */
export type TypeScriptStatementScope = ts.Block | ts.SourceFile;

const indexedScopesBySourceFile = new WeakMap<
  ts.SourceFile,
  ReadonlySet<TypeScriptStatementScope>
>();

/**
 * Returns only statement scopes reached by Oxc's existing semantic initializer
 * walk, keeping compatibility collection from inferring evidence in containers
 * that the native frontend intentionally skips.
 */
export function oxcIndexedStatementScopes(
  sourceFile: ts.SourceFile,
): ReadonlySet<TypeScriptStatementScope> {
  const cached = indexedScopesBySourceFile.get(sourceFile);
  if (cached) return cached;

  const scopes = new Set<TypeScriptStatementScope>();
  const visitStatements = (
    scope: TypeScriptStatementScope,
    statements: readonly ts.Statement[],
  ): void => {
    scopes.add(scope);
    for (const statement of statements) visitStatement(statement);
  };
  const visitStatement = (statement: ts.Statement): void => {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (declaration.initializer) visitExpression(declaration.initializer);
      }
      return;
    }
    if (ts.isFunctionDeclaration(statement)) {
      if (statement.body)
        visitStatements(statement.body, statement.body.statements);
      return;
    }
    if (ts.isExpressionStatement(statement)) {
      visitExpression(statement.expression);
      return;
    }
    if (ts.isReturnStatement(statement)) {
      if (statement.expression) visitExpression(statement.expression);
      return;
    }
    if (
      ts.isExportAssignment(statement) &&
      !statement.isExportEquals &&
      (ts.isCallExpression(statement.expression) ||
        ts.isNewExpression(statement.expression))
    ) {
      visitExpression(statement.expression);
      return;
    }
    if (ts.isBlock(statement)) {
      visitStatements(statement, statement.statements);
      return;
    }
    if (!ts.isIfStatement(statement)) return;
    visitExpression(statement.expression);
    visitStatement(statement.thenStatement);
    if (statement.elseStatement) visitStatement(statement.elseStatement);
  };
  const visitFunctionBody = (body: ts.ConciseBody | undefined): void => {
    if (!body) return;
    if (ts.isBlock(body)) {
      visitStatements(body, body.statements);
    } else {
      visitExpression(body);
    }
  };
  const visitExpression = (expression: ts.Expression): void => {
    if (ts.isCallExpression(expression) || ts.isNewExpression(expression)) {
      visitExpression(expression.expression);
      for (const argument of expression.arguments ?? []) {
        visitExpression(
          ts.isSpreadElement(argument) ? argument.expression : argument,
        );
      }
      return;
    }
    if (ts.isObjectLiteralExpression(expression)) {
      for (const property of expression.properties) {
        if (ts.isPropertyAssignment(property)) {
          visitExpression(property.initializer);
        } else if (ts.isSpreadAssignment(property)) {
          visitExpression(property.expression);
        } else if (
          ts.isMethodDeclaration(property) ||
          ts.isGetAccessorDeclaration(property) ||
          ts.isSetAccessorDeclaration(property)
        ) {
          visitFunctionBody(property.body);
        }
      }
      return;
    }
    if (ts.isArrayLiteralExpression(expression)) {
      for (const element of expression.elements) {
        if (ts.isOmittedExpression(element)) continue;
        visitExpression(
          ts.isSpreadElement(element) ? element.expression : element,
        );
      }
      return;
    }
    if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
      visitFunctionBody(expression.body);
      return;
    }
    if (ts.isAwaitExpression(expression)) {
      visitExpression(expression.expression);
      return;
    }
    if (ts.isPropertyAccessExpression(expression)) {
      visitExpression(expression.expression);
      return;
    }
    if (ts.isParenthesizedExpression(expression))
      visitExpression(expression.expression);
  };

  visitStatements(sourceFile, sourceFile.statements);
  indexedScopesBySourceFile.set(sourceFile, scopes);
  return scopes;
}
