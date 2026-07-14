import type { ExtractContext } from "../extensions";
import ts from "typescript";
import {
  internalStaticRecordContext,
  internalTypeScriptContext,
} from "../static-index/compatibility/syntax-record-bridge/native-context";
import {
  resolveStaticSyntaxValue,
  staticObjectPropertyValue,
} from "../static-index/syntax/record/value";

/** Returns whether the authored transport is provably a function resolver. */
export function hasMcpTransportResolver(ctx: ExtractContext): boolean {
  const typescript = internalTypeScriptContext(ctx);
  if (typescript?.objectArg) {
    const property = typescript.objectArg.properties.find(
      (item) => item.name?.getText(typescript.sourceFile) === "transport",
    );
    if (property && ts.isPropertyAssignment(property)) {
      const expression = property.initializer;
      if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression))
        return true;
      if (ts.isIdentifier(expression)) {
        const symbol = expression.getText(typescript.sourceFile);
        const declaration = typescript.sourceFile.statements.find(
          (statement) => {
            if (
              ts.isFunctionDeclaration(statement) &&
              statement.name?.text === symbol
            )
              return true;
            return (
              ts.isVariableStatement(statement) &&
              statement.declarationList.declarations.some(
                (item) => item.name.getText(typescript.sourceFile) === symbol,
              )
            );
          },
        );
        if (declaration && ts.isFunctionDeclaration(declaration)) return true;
        if (declaration && ts.isVariableStatement(declaration)) {
          const initializer = declaration.declarationList.declarations.find(
            (item) => item.name.getText(typescript.sourceFile) === symbol,
          )?.initializer;
          return Boolean(
            initializer &&
            (ts.isArrowFunction(initializer) ||
              ts.isFunctionExpression(initializer)),
          );
        }
      }
    }
  }

  const record = internalStaticRecordContext(ctx);
  if (!record?.objectArg) return false;
  const transport = staticObjectPropertyValue(record.objectArg, "transport");
  return (
    resolveStaticSyntaxValue(transport, record.initializers)?.kind ===
    "function"
  );
}
