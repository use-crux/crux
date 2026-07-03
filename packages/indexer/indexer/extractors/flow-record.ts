import type { ExtractContext, ExtractedFacts } from "../extensions";
import {
  internalStaticRecordContext,
  type InternalStaticRecordContext,
} from "../static-index/compatibility/syntax-record-bridge/native-context";
import {
  staticObjectPropertyValue,
  staticObjectValue,
} from "../static-index/syntax/record/value";
import {
  isObjectStyleFlowCall,
  recordFlowOptionsObject,
} from "./flow-record-options";
import { recordFlowTraversal } from "./flow-record-traversal";
import {
  flowFactsFromEvidence,
} from "./flow-facts";

/** Projects `flow(...)` syntax records into immutable index facts. */
export function flowFactsFromStaticRecordContext(
  ctx: ExtractContext,
): ExtractedFacts | undefined {
  const recordCtx = internalStaticRecordContext(ctx);
  if (
    !recordCtx ||
    (ctx.match.name !== "flow" && ctx.match.name !== "cruxFlow")
  )
    return undefined;
  if (recordCtx.match.kind !== "call") return undefined;
  const explicitName = ctx.args.string(0) ?? ctx.config?.string("name");
  const nameLiteral = recordFlowNameIsLiteral(recordCtx);
  return flowFactsFromEvidence({
    variableName: ctx.source.variableName,
    localName: ctx.source.localName,
    callName: ctx.match.name,
    runtime: recordFlowRuntime(recordCtx),
    explicitName,
    nameLiteral,
    exported: ctx.source.exported === true,
    args: recordArgsKeys(recordCtx),
    argsSchema: ctx.config?.schema("args") as
      | Record<string, unknown>
      | undefined,
    hasArgs: ctx.config?.has("args") ?? false,
    signalNames: recordSignalKeys(recordCtx),
    traversal: recordFlowTraversal(
      recordCtx,
      explicitName ?? ctx.source.localName,
      ctx.source.safeId,
    ),
    safeId: ctx.source.safeId,
    define: (id, kind, name, metadata) =>
      ctx.define.definition({
        variableName: ctx.source.variableName,
        id,
        kind,
        name,
        metadata,
      }).definition,
  });
}

function recordFlowNameIsLiteral(ctx: InternalStaticRecordContext): boolean {
  if (ctx.match.kind !== "call") return false;
  const positionalName = ctx.match.args[0];
  if (
    positionalName?.kind === "literal" &&
    typeof positionalName.value === "string"
  )
    return true;
  if (!isObjectStyleFlowCall(ctx) || !ctx.objectArg) return false;
  const configuredName = staticObjectPropertyValue(ctx.objectArg, "name");
  return (
    configuredName?.kind === "literal" &&
    typeof configuredName.value === "string"
  );
}

function recordFlowRuntime(
  ctx: InternalStaticRecordContext,
): "convex" | "node" {
  if (ctx.match.kind !== "call") return "node";
  const callee = ctx.match.callee;
  return callee.localName === "cruxFlow" ||
    callee.moduleSpecifier?.startsWith("@use-crux/convex")
    ? "convex"
    : "node";
}

function recordArgsKeys(
  ctx: InternalStaticRecordContext,
): readonly string[] | undefined {
  if (!isObjectStyleFlowCall(ctx) || !ctx.objectArg) return undefined;
  const args = staticObjectValue(
    staticObjectPropertyValue(ctx.objectArg, "args"),
    ctx.initializers,
  );
  const keys = args?.properties.flatMap((property) =>
    property.spread ? [] : [property.name],
  );
  return keys && keys.length > 0 ? keys : undefined;
}

/** Reads local flow signal names from record-backed definition metadata. */
function recordSignalKeys(
  ctx: InternalStaticRecordContext,
): readonly string[] | undefined {
  const options = recordFlowOptionsObject(ctx);
  if (!options) return undefined;
  const signals = staticObjectValue(
    staticObjectPropertyValue(options, "signals"),
    ctx.initializers,
  );
  return signals?.properties.flatMap((property) =>
    property.spread ? [] : [property.name],
  );
}
