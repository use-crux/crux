import {
  facts,
  none,
  type ExtractContext,
  type UnresolvedReference,
} from "../extensions";
import { internalStaticRecordContext } from "../static-index/compatibility/syntax-record-bridge/native-context";
import type {
  StaticObjectValue,
  StaticSyntaxValue,
} from "../static-index/syntax/record/types";
import {
  createStaticSyntaxInitializerMap,
  resolveStaticSyntaxValue,
  staticObjectPropertyValue,
  type StaticSyntaxInitializerMap,
} from "../static-index/syntax/record/value";

const promptModules = new Set(["@use-crux/core"]);

/** Projects authored Thread definitions and their direct Prompt bindings. */
export function extractThreadStaticFacts(ctx: ExtractContext) {
  if (ctx.match.name === "prompt") return extractPromptThreadBindings(ctx);
  if (ctx.match.name !== "thread") return none();
  const config = ctx.config;
  if (!config) return none();
  const explicitId = config.string("id");
  const id = `thread:${ctx.source.safeId(explicitId ?? ctx.source.localName)}`;
  return facts({
    definitions: [
      ctx.define.definition({
        variableName: ctx.source.variableName,
        id,
        kind: "thread",
        name: explicitId ?? ctx.source.variableName,
        metadata: {
          exportName: ctx.source.variableName,
          ...(ctx.source.exported ? { exported: true } : {}),
          facts: { kind: "thread" },
        },
      }),
    ],
  });
}

function extractPromptThreadBindings(ctx: ExtractContext) {
  const native = internalStaticRecordContext(ctx);
  if (
    !native ||
    native.match.kind !== "call" ||
    native.match.callee.importedName !== "prompt" ||
    native.match.callee.moduleSpecifier === undefined ||
    !promptModules.has(native.match.callee.moduleSpecifier) ||
    !native.match.objectArg
  ) {
    return none();
  }
  const use = staticObjectPropertyValue(native.match.objectArg, "use");
  if (!use) return none();
  const threadVariables = canonicalThreadVariables(native);
  const targets = [...threadVariables].filter((variable) =>
    referencesVariable(use, variable, native.initializers),
  );
  if (targets.length === 0) return none();
  const explicitId = directStringProperty(native.match.objectArg, "id");
  const fromId = `prompt:${ctx.source.safeId(
    explicitId ?? native.match.localName,
  )}`;
  const references: UnresolvedReference[] = targets.map((toVariable) => ({
    type: "prompt.uses_context",
    typeByTargetKind: { thread: "prompt.uses_thread" },
    fromId,
    toVariable,
    source: native.match.source,
  }));
  return facts({ references });
}

function canonicalThreadVariables(
  native: NonNullable<ReturnType<typeof internalStaticRecordContext>>,
): ReadonlySet<string> {
  const variables = new Set(
    native.record.matches.flatMap((match) =>
      isCanonicalThreadMatch(match) ? [match.variableName] : [],
    ),
  );
  for (const imported of native.record.imports) {
    if (!imported.resolvedFile || imported.importedName === "default") continue;
    const importedRecord = native.recordsByFile?.get(imported.resolvedFile);
    if (
      importedRecord?.matches.some(
        (match) =>
          match.variableName === imported.importedName &&
          isCanonicalThreadMatch(match),
      )
    ) {
      variables.add(imported.localName);
    }
  }
  return variables;
}

function isCanonicalThreadMatch(
  match: NonNullable<
    ReturnType<typeof internalStaticRecordContext>
  >["record"]["matches"][number],
): boolean {
  return (
    match.kind === "call" &&
    match.callee.importedName === "thread" &&
    match.callee.moduleSpecifier === "@use-crux/core/thread"
  );
}

function referencesVariable(
  value: StaticSyntaxValue,
  variable: string,
  initializers: StaticSyntaxInitializerMap,
  seen: ReadonlySet<string> = new Set(),
): boolean {
  if (value.kind === "array") {
    return value.elements.some((element) =>
      referencesVariable(element, variable, initializers, seen),
    );
  }
  if (value.kind === "identifier") {
    const initializer = initializers.get(value.name);
    if (initializer?.kind === "array" && !seen.has(value.name)) {
      return referencesVariable(
        initializer,
        variable,
        initializers,
        new Set([...seen, value.name]),
      );
    }
    return value.name === variable;
  }
  if (value.kind !== "call") return false;
  const callName = value.callee.localName ?? value.callee.name;
  if (callName === "when") {
    const entry = value.args[1];
    return entry
      ? referencesVariable(entry, variable, initializers, seen)
      : false;
  }
  if (callName !== "match") return false;
  const input = value.args[0];
  const resolvedInput = resolveStaticSyntaxValue(input, initializers);
  const object = resolvedInput?.kind === "object" ? resolvedInput : undefined;
  if (!object) return false;
  const cases = resolveStaticSyntaxValue(
    staticObjectPropertyValue(object, "cases"),
    initializers,
  );
  const caseMatch =
    cases?.kind === "object" &&
    cases.properties.some(
      (property) =>
        !property.spread &&
        referencesVariable(property.value, variable, initializers, seen),
    );
  const fallback = staticObjectPropertyValue(object, "default");
  return Boolean(
    caseMatch ||
    (fallback && referencesVariable(fallback, variable, initializers, seen)),
  );
}

function directStringProperty(
  object: StaticObjectValue,
  property: string,
): string | undefined {
  const value = staticObjectPropertyValue(object, property);
  return value?.kind === "literal" && typeof value.value === "string"
    ? value.value
    : undefined;
}
