import ts from "typescript";
import type {
  StaticImportRecord,
  StaticInitializerRecord,
  StaticNewSourceMatch,
  StaticObjectValue,
  StaticSourceMatch,
} from "./types";
import { sourceForNode, sourceSnippetForNode } from "../../../ast/snippets";
import type {
  StaticSyntaxCalleeMatcher,
  StaticSyntaxEvidenceSlice,
} from "./interests";
import {
  expressionName,
  staticCalleeRecordFromExpression,
} from "./typescript-callee";
import {
  staticObjectValueFromExpression,
  staticSyntaxValueFromExpression,
} from "./typescript-values";
import { staticFallbackLocalName } from "../../../static/local-name";

/**
 * TypeScript parser helpers for converting declarations and expressions into
 * backend-neutral Static Syntax match records.
 *
 * @module
 */

/** Shared parser context used to construct Static Syntax match records. */
export interface TypeScriptStaticSyntaxMatchInput {
  readonly root: string;
  readonly file: string;
  readonly sourceFile: ts.SourceFile;
  readonly importsByLocalName: ReadonlyMap<string, StaticImportRecord>;
  readonly callMatcher: StaticSyntaxCalleeMatcher;
  readonly constructorMatcher: StaticSyntaxCalleeMatcher;
}

/**
 * Converts an exported or local variable initializer into a Static Syntax
 * match when the initializer is a supported object, function call, or
 * constructor call.
 */
export function matchFromInitializer(
  input: TypeScriptStaticSyntaxMatchInput,
  variableName: string,
  initializer: ts.Expression,
  exported: boolean,
  scopedInitializers: readonly StaticInitializerRecord[] = [],
): StaticSourceMatch | undefined {
  if (ts.isObjectLiteralExpression(initializer)) {
    return {
      kind: "object",
      variableName,
      localName: staticFallbackLocalName(input.root, input.file, variableName),
      exported,
      object: staticObjectValueFromExpression(
        input.sourceFile,
        initializer,
        input.importsByLocalName,
      ),
      source: sourceForNode(input.sourceFile, initializer),
      snippet: sourceSnippetForNode(input.sourceFile, initializer),
      ...(scopedInitializers.length > 0
        ? { localInitializers: scopedInitializers }
        : {}),
    };
  }
  if (ts.isCallExpression(initializer)) {
    const callee = staticCalleeRecordFromExpression(
      initializer.expression,
      input.importsByLocalName,
    );
    return input.callMatcher.allows(callee)
      ? callMatch(
          input,
          variableName,
          initializer,
          exported,
          scopedInitializers,
        )
      : undefined;
  }
  if (ts.isNewExpression(initializer))
    return newMatch(
      input,
      variableName,
      initializer,
      exported,
      scopedInitializers,
    );
  return undefined;
}

/** Creates a Static Syntax match for a matched function call expression. */
export function callMatch(
  input: TypeScriptStaticSyntaxMatchInput,
  variableName: string,
  call: ts.CallExpression,
  exported: boolean,
  scopedInitializers: readonly StaticInitializerRecord[] = [],
  ownerVariableName?: string,
): StaticSourceMatch {
  const callee = staticCalleeRecordFromExpression(
    call.expression,
    input.importsByLocalName,
  );
  const evidence = input.callMatcher.evidenceFor(callee);
  const objectArg = objectArgument(call.arguments, evidence);
  const objectValue = objectArg
    ? slicedObjectValue(
        staticObjectValueFromExpression(
          input.sourceFile,
          objectArg,
          input.importsByLocalName,
        ),
        evidence,
      )
    : undefined;
  return {
    kind: "call",
    eagerExecution: isEagerExecution(call),
    variableName,
    ...(ownerVariableName ? { ownerVariableName } : {}),
    localName: staticFallbackLocalName(input.root, input.file, variableName),
    exported,
    callee,
    args: call.arguments.map((arg) =>
      staticSyntaxValueFromExpression(
        input.sourceFile,
        arg,
        input.importsByLocalName,
      ),
    ),
    ...(objectValue ? { objectArg: objectValue } : {}),
    source: sourceForNode(input.sourceFile, call),
    snippet: sourceSnippetForNode(input.sourceFile, call),
    ...(scopedInitializers.length > 0
      ? { localInitializers: scopedInitializers }
      : {}),
  };
}

function isEagerExecution(call: ts.CallExpression): boolean {
  for (
    let current: ts.Node | undefined = call.parent;
    current;
    current = current.parent
  ) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current) ||
      ts.isMethodDeclaration(current) ||
      ts.isConstructorDeclaration(current)
    ) {
      return false;
    }
    if (ts.isSourceFile(current)) return true;
  }
  return false;
}

/** Creates a Static Syntax match for a matched constructor expression. */
export function newMatch(
  input: TypeScriptStaticSyntaxMatchInput,
  variableName: string,
  node: ts.NewExpression,
  exported: boolean,
  scopedInitializers: readonly StaticInitializerRecord[] = [],
): StaticNewSourceMatch | undefined {
  const name = expressionName(node.expression);
  if (!name) return undefined;
  const callee = staticCalleeRecordFromExpression(
    node.expression,
    input.importsByLocalName,
  );
  if (!input.constructorMatcher.allows(callee)) return undefined;
  const evidence = input.constructorMatcher.evidenceFor(callee);
  const objectArg = objectArgument([...(node.arguments ?? [])], evidence);
  const objectValue = objectArg
    ? slicedObjectValue(
        staticObjectValueFromExpression(
          input.sourceFile,
          objectArg,
          input.importsByLocalName,
        ),
        evidence,
      )
    : undefined;
  return {
    kind: "new",
    variableName,
    localName: staticFallbackLocalName(input.root, input.file, variableName),
    exported,
    callee,
    args: [...(node.arguments ?? [])].map((arg) =>
      staticSyntaxValueFromExpression(
        input.sourceFile,
        arg,
        input.importsByLocalName,
      ),
    ),
    ...(objectValue ? { objectArg: objectValue } : {}),
    source: sourceForNode(input.sourceFile, node),
    snippet: sourceSnippetForNode(input.sourceFile, node),
    ...(scopedInitializers.length > 0
      ? { localInitializers: scopedInitializers }
      : {}),
  };
}

function objectArgument(
  args: readonly ts.Expression[],
  evidence: StaticSyntaxEvidenceSlice | undefined,
): ts.ObjectLiteralExpression | undefined {
  if (evidence?.configArg !== undefined) {
    const arg = args[evidence.configArg];
    return arg && ts.isObjectLiteralExpression(arg) ? arg : undefined;
  }
  return args.find((arg): arg is ts.ObjectLiteralExpression =>
    ts.isObjectLiteralExpression(arg),
  );
}

function slicedObjectValue(
  object: StaticObjectValue,
  evidence: StaticSyntaxEvidenceSlice | undefined,
): StaticObjectValue | undefined {
  if (!evidence) return object;
  if (evidence.properties.size === 0) return undefined;
  return {
    ...object,
    properties: object.properties.filter(
      (property) => !property.spread && evidence.properties.has(property.name),
    ),
  };
}
