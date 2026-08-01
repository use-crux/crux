import type { KnowledgeDefinitionFacts } from "@use-crux/core/project-index";
import { facts, none, type ExtractContext } from "../extensions";
import { safeId } from "../definitions";
import { internalStaticRecordContext } from "../static-index/compatibility/syntax-record-bridge/native-context";
import type {
  StaticObjectValue,
  StaticSourceMatch,
  StaticSyntaxValue,
} from "../static-index/syntax/record/types";
import {
  resolveStaticSyntaxValue,
  staticObjectPropertyValue,
  type StaticSyntaxInitializerMap,
} from "../static-index/syntax/record/value";

const knowledgeBaseModules = new Set([
  "@use-crux/core/knowledge",
  "@use-crux/core/retrieval",
  "@use-crux/core",
]);

/** Projects `knowledgeBase().view()` definitions from bounded method-call evidence. */
export function extractKnowledgeView(ctx: ExtractContext) {
  const native = internalStaticRecordContext(ctx);
  if (!native || native.match.kind !== "call" || !native.match.objectArg) {
    return none();
  }
  const receiver = native.match.callee.receiverName;
  if (!receiver) return none();
  const knowledgeBaseId = canonicalKnowledgeBaseIds(native).get(receiver);
  if (!knowledgeBaseId) return none();
  const viewId = directStringProperty(native.match.objectArg, "id");
  if (!viewId) return none();
  const id = `${knowledgeBaseId}:view:${ctx.source.safeId(viewId)}`;
  const factsValue: KnowledgeDefinitionFacts = {
    kind: "rag.knowledgeBase.view",
    knowledgeBaseId,
    viewId,
    whereFields: whereFields(native.match.objectArg, native.initializers),
  };
  return facts({
    definitions: [
      ctx.define.definition({
        variableName: ctx.source.variableName,
        id,
        kind: "rag.knowledgeBase.view",
        name: viewId,
        metadata: {
          exportName: ctx.source.variableName,
          ...(ctx.source.exported ? { exported: true } : {}),
          indexPresentation: {
            standalone: false,
            role: "view",
            parentDefinitionId: knowledgeBaseId,
            parentRelationType: "rag.knowledgeBase.includes_view",
          },
          facts: factsValue,
        },
      }),
    ],
    references: [
      {
        type: "rag.knowledgeBase.includes_view",
        fromId: knowledgeBaseId,
        toId: id,
        source: native.match.source,
      },
    ],
  });
}

function canonicalKnowledgeBaseIds(
  native: NonNullable<ReturnType<typeof internalStaticRecordContext>>,
): ReadonlyMap<string, string> {
  const ids = new Map(
    native.record.matches.flatMap((match): [string, string][] =>
      isKnowledgeBaseMatch(match)
        ? [[match.variableName, knowledgeBaseDefinitionId(match)]]
        : [],
    ),
  );
  for (const imported of native.record.imports) {
    if (!imported.resolvedFile || imported.importedName === "default") continue;
    const importedRecord = native.recordsByFile?.get(imported.resolvedFile);
    const match = importedRecord?.matches.find(
      (item) =>
        item.variableName === imported.importedName && isKnowledgeBaseMatch(item),
    );
    if (match) ids.set(imported.localName, knowledgeBaseDefinitionId(match));
  }
  return ids;
}

function isKnowledgeBaseMatch(match: StaticSourceMatch): boolean {
  return (
    match.kind === "call" &&
    match.callee.importedName === "knowledgeBase" &&
    knowledgeBaseModules.has(match.callee.moduleSpecifier ?? "")
  );
}

function knowledgeBaseDefinitionId(match: StaticSourceMatch): string {
  const id =
    match.kind === "call" && match.objectArg
      ? directStringProperty(match.objectArg, "id")
      : undefined;
  return `rag.knowledgeBase:${safeId(id ?? match.localName)}`;
}

function whereFields(
  object: StaticObjectValue,
  initializers: StaticSyntaxInitializerMap,
): string[] {
  const where = resolveStaticSyntaxValue(
    staticObjectPropertyValue(object, "where"),
    initializers,
  );
  const fields = new Set<string>();
  collectWhereFields(where, fields, initializers);
  return [...fields].sort();
}

function collectWhereFields(
  value: StaticSyntaxValue | undefined,
  fields: Set<string>,
  initializers: StaticSyntaxInitializerMap,
): void {
  const resolved = resolveStaticSyntaxValue(value, initializers);
  if (resolved?.kind !== "object") return;
  const any = staticObjectPropertyValue(resolved, "any");
  if (any?.kind === "array") {
    for (const clause of any.elements) {
      collectWhereFields(clause, fields, initializers);
    }
    return;
  }
  for (const property of resolved.properties) {
    if (!property.spread) fields.add(property.name);
  }
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
