import ts from "typescript";
import type {
  StaticArrayValue,
  StaticCalleeRecord,
  StaticFunctionParameterBinding,
  StaticInitializerRecord,
  StaticImportRecord,
  StaticObjectProperty,
  StaticObjectValue,
  StaticSyntaxValue,
} from "./types";
import { propertyName } from "../../../ast/literals";
import { sourceForNode, sourceSnippetForNode } from "../../../ast/snippets";
import { staticFunctionValueFromNode } from "./typescript-function-values";

/**
 * Converts a TypeScript expression into a backend-neutral syntax value.
 *
 * The conversion is conservative: values that require evaluation are represented as `unsupported`
 * instead of embedding TypeScript AST nodes or guessing runtime behavior.
 */
export function staticSyntaxValueFromExpression(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
  importsByLocalName: ReadonlyMap<string, StaticImportRecord>,
): StaticSyntaxValue {
  if (ts.isStringLiteralLike(expression))
    return { kind: "literal", value: expression.text };
  if (ts.isNumericLiteral(expression))
    return { kind: "literal", value: Number(expression.text) };
  if (expression.kind === ts.SyntaxKind.TrueKeyword)
    return { kind: "literal", value: true };
  if (expression.kind === ts.SyntaxKind.FalseKeyword)
    return { kind: "literal", value: false };
  if (expression.kind === ts.SyntaxKind.NullKeyword)
    return { kind: "literal", value: null };
  if (ts.isIdentifier(expression))
    return { kind: "identifier", name: expression.text };
  if (ts.isPropertyAccessExpression(expression)) {
    const path = propertyAccessPath(expression);
    return { kind: "property-access", name: path[path.length - 1] ?? "", path };
  }
  if (ts.isObjectLiteralExpression(expression)) {
    return staticObjectValueFromExpression(
      sourceFile,
      expression,
      importsByLocalName,
    );
  }
  if (ts.isArrayLiteralExpression(expression)) {
    return {
      kind: "array",
      elements: expression.elements.map((element) =>
        staticSyntaxValueFromExpression(
          sourceFile,
          element as ts.Expression,
          importsByLocalName,
        ),
      ),
    } satisfies StaticArrayValue;
  }
  if (ts.isCallExpression(expression)) {
    return {
      kind: "call",
      callee: staticCalleeRecordFromExpression(
        expression.expression,
        importsByLocalName,
      ),
      ...(ts.isPropertyAccessExpression(expression.expression)
        ? {
            receiver: staticSyntaxValueFromExpression(
              sourceFile,
              expression.expression.expression,
              importsByLocalName,
            ),
          }
        : {}),
      args: expression.arguments.map((arg) =>
        staticSyntaxValueFromExpression(sourceFile, arg, importsByLocalName),
      ),
      source: sourceForNode(sourceFile, expression),
      snippet: sourceSnippetForNode(sourceFile, expression),
    };
  }
  if (ts.isTemplateExpression(expression)) {
    return {
      kind: "template",
      text: expression.getText(sourceFile),
      expressions: expression.templateSpans.map((span) =>
        staticSyntaxValueFromExpression(
          sourceFile,
          span.expression,
          importsByLocalName,
        ),
      ),
    };
  }
  if (ts.isNoSubstitutionTemplateLiteral(expression))
    return { kind: "literal", value: expression.text };
  if (ts.isAwaitExpression(expression)) {
    return staticSyntaxValueFromExpression(
      sourceFile,
      expression.expression,
      importsByLocalName,
    );
  }
  if (ts.isParenthesizedExpression(expression)) {
    return staticSyntaxValueFromExpression(
      sourceFile,
      expression.expression,
      importsByLocalName,
    );
  }
  if (
    ts.isArrowFunction(expression) ||
    ts.isFunctionExpression(expression) ||
    ts.isClassExpression(expression)
  ) {
    return staticFunctionValueFromNode(
      sourceFile,
      expression,
      importsByLocalName,
    );
  }
  return {
    kind: "unsupported",
    syntaxKind: ts.SyntaxKind[expression.kind] ?? String(expression.kind),
    source: sourceForNode(sourceFile, expression),
  };
}

/** Converts an object literal into a record-backed object value. */
export function staticObjectValueFromExpression(
  sourceFile: ts.SourceFile,
  object: ts.ObjectLiteralExpression,
  importsByLocalName: ReadonlyMap<string, StaticImportRecord>,
): StaticObjectValue {
  return {
    kind: "object",
    properties: object.properties.flatMap(
      (item): readonly StaticObjectProperty[] => {
        if (ts.isSpreadAssignment(item)) {
          const name = expressionName(item.expression);
          if (!name) return [];
          return [
            {
              name,
              value: staticSyntaxValueFromExpression(
                sourceFile,
                item.expression,
                importsByLocalName,
              ),
              shorthand: false,
              spread: true,
              source: sourceForNode(sourceFile, item),
            },
          ];
        }
        if (ts.isShorthandPropertyAssignment(item)) {
          return [
            {
              name: item.name.text,
              value: { kind: "identifier", name: item.name.text },
              shorthand: true,
              source: sourceForNode(sourceFile, item),
            },
          ];
        }
        if (!ts.isPropertyAssignment(item)) return [];
        const name = propertyName(item.name);
        if (!name) return [];
        return [
          {
            name,
            value: staticSyntaxValueFromExpression(
              sourceFile,
              item.initializer,
              importsByLocalName,
            ),
            shorthand: false,
            source: sourceForNode(sourceFile, item),
          },
        ];
      },
    ),
    source: sourceForNode(sourceFile, object),
    snippet: sourceSnippetForNode(sourceFile, object),
  };
}

/** Normalizes a call or constructor expression into a stable callee record. */
export function staticCalleeRecordFromExpression(
  expression: ts.Expression,
  importsByLocalName: ReadonlyMap<string, StaticImportRecord>,
): StaticCalleeRecord {
  const localName = expressionName(expression);
  const direct = ts.isIdentifier(expression);
  const receiverName =
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression)
      ? expression.expression.text
      : undefined;
  if (!localName) return { name: "<unknown>", direct };
  const imported = importsByLocalName.get(localName);
  if (!imported)
    return {
      name: localName,
      localName,
      direct,
      ...(receiverName ? { receiverName } : {}),
    };
  return {
    name: imported.importedName,
    direct,
    localName,
    ...(receiverName ? { receiverName } : {}),
    importedName: imported.importedName,
    moduleSpecifier: imported.moduleSpecifier,
    ...(imported.resolvedFile ? { resolvedFile: imported.resolvedFile } : {}),
  };
}

/** Returns the final user-facing expression name for simple callable expressions. */
export function expressionName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return undefined;
}

function propertyAccessPath(
  expression: ts.PropertyAccessExpression,
): readonly string[] {
  const names: string[] = [expression.name.text];
  let current: ts.Expression = expression.expression;
  while (ts.isPropertyAccessExpression(current)) {
    names.unshift(current.name.text);
    current = current.expression;
  }
  if (ts.isIdentifier(current)) names.unshift(current.text);
  return names;
}

/** Converts supported variable declarations into local initializer records. */
export function staticInitializerRecordsFromDeclaration(
  sourceFile: ts.SourceFile,
  declaration: ts.VariableDeclaration,
  importsByLocalName: ReadonlyMap<string, StaticImportRecord>,
): readonly StaticInitializerRecord[] {
  if (!declaration.initializer) return [];
  const names = bindingNames(declaration.name);
  if (names.length === 0) return [];
  const value = staticSyntaxValueFromExpression(
    sourceFile,
    declaration.initializer,
    importsByLocalName,
  );
  const source = sourceForNode(sourceFile, declaration.initializer);
  const snippet = sourceSnippetForNode(sourceFile, declaration.initializer);
  return names.map((name) => ({
    name,
    value,
    source,
    snippet,
  }));
}

export function bindingNames(name: ts.BindingName): readonly string[] {
  return bindingEntries(name).map((binding) => binding.name);
}

export function bindingEntries(
  name: ts.BindingName,
  property?: string,
): readonly StaticFunctionParameterBinding[] {
  if (ts.isIdentifier(name)) {
    return [
      { name: name.text, ...(property ? { propertyName: property } : {}) },
    ];
  }
  return name.elements.flatMap(
    (element): readonly StaticFunctionParameterBinding[] => {
      if (ts.isOmittedExpression(element)) return [];
      const elementProperty =
        ts.isBindingElement(element) && element.propertyName
          ? propertyName(element.propertyName)
          : undefined;
      return bindingEntries(element.name, elementProperty);
    },
  );
}
