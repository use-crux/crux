import type { SessionFacts } from "@use-crux/core/project-index";
import { facts, none, type ExtractContext } from "../extensions";
import { internalStaticRecordContext } from "../static-index/compatibility/syntax-record-bridge/native-context";
import {
  createStaticRecordSourceResolver,
  type ResolvedStaticRecordSource,
} from "../static-index/compatibility/syntax-record-bridge/source-resolver";
import type { StaticSyntaxValue } from "../static-index/syntax/record/types";
import {
  staticObjectPropertyValue,
  staticReferenceName,
  staticStringValue,
} from "../static-index/syntax/record/value";

const agentModules = new Set([
  "@use-crux/core/agent",
  "@use-crux/convex",
  "@use-crux/convex/agent",
]);

/** Projects one authored Session construction or keyed lookup. */
export function extractSessionStaticFacts(ctx: ExtractContext) {
  const native = internalStaticRecordContext(ctx);
  if (!native || native.match.kind !== "call") return none();
  const operation = sessionOperation(native.match.callee.importedName);
  if (!operation) return none();

  const targetValue = native.match.args[0];
  const targetVariable = staticReferenceName(targetValue);
  const resolver = createStaticRecordSourceResolver({
    record: native.record,
    initializers: native.initializers,
    initializerRecords: native.initializerRecords,
    ...(native.recordsByFile ? { recordsByFile: native.recordsByFile } : {}),
  });
  const target = resolver.resolveValue(targetValue);
  const targetDefinitionId = targetAgentDefinitionId(target, ctx);
  const key = sessionKey(operation, native.match.args, native.initializers);
  const targetForm = targetDefinitionId
    ? ({ kind: "agent" } as const)
    : targetValue?.kind === "identifier" ||
        targetValue?.kind === "property-access"
      ? ({ kind: "unresolved" } as const)
      : ({ kind: "dynamic" } as const);
  const call = sessionCall(operation, native.match.args, resolver);
  const targetName =
    targetDefinitionId?.slice("agent:".length) ?? targetVariable;
  const stableIdentity = Boolean(targetDefinitionId && key);
  const authoredIdentity = stableIdentity
    ? `${targetName}:${key}`
    : `${native.record.relativePath}:${native.match.source.line}:${native.match.source.column}`;
  const definitionId = `session:${ctx.source.safeId(authoredIdentity)}`;
  const sessionFacts: SessionFacts = {
    kind: "session",
    operation,
    ...(targetVariable ? { targetVariable } : {}),
    ...(targetDefinitionId ? { targetDefinitionId } : {}),
    target: targetForm,
    key:
      key !== undefined ? { kind: "literal", value: key } : { kind: "dynamic" },
    identity: stableIdentity ? "static" : "partial",
    call,
  };
  const references = targetDefinitionId
    ? [ctx.ref.id("session.targets_agent", targetDefinitionId)]
    : targetVariable
      ? [ctx.ref.variable("session.targets_agent", targetVariable)]
      : [];

  return facts({
    definitions: [
      ctx.define.definition({
        variableName: ctx.source.variableName,
        id: definitionId,
        kind: "session",
        name: stableIdentity ? `${targetName}:${key}` : ctx.source.variableName,
        metadata: {
          ...(ctx.source.exported ? { exported: true } : {}),
          exportName: ctx.source.variableName,
          facts: sessionFacts,
        },
      }),
    ],
    ...(references.length ? { references } : {}),
    ...(target
      ? {
          sourceRefs: [
            {
              definitionId,
              ref: resolver.sourceRef({
                definitionId,
                role: "config",
                property: "target",
                resolved: target,
              }),
            },
          ],
        }
      : {}),
  });
}

function sessionCall(
  operation: "create" | "get",
  args: readonly StaticSyntaxValue[],
  resolver: ReturnType<typeof createStaticRecordSourceResolver>,
): SessionFacts["call"] {
  if (args.length !== 2) return { kind: "ambiguous", reason: "arity" };
  if (operation === "get") return { kind: "supported" };
  const options = args[1];
  const resolved = resolver.resolveValue(options)?.value ?? options;
  return resolved?.kind === "object"
    ? { kind: "supported" }
    : { kind: "ambiguous", reason: "options" };
}

function sessionOperation(
  name: string | undefined,
): "create" | "get" | undefined {
  if (name === "session") return "create";
  if (name === "getSession") return "get";
  return undefined;
}

function sessionKey(
  operation: "create" | "get",
  args: readonly StaticSyntaxValue[],
  initializers: Parameters<typeof staticStringValue>[1],
): string | undefined {
  const value = args[1];
  if (operation === "get") return staticStringValue(value, initializers);
  if (value?.kind !== "object") return undefined;
  return staticStringValue(
    staticObjectPropertyValue(value, "key"),
    initializers,
  );
}

function targetAgentDefinitionId(
  target: ResolvedStaticRecordSource | undefined,
  ctx: ExtractContext,
): string | undefined {
  if (target?.value.kind !== "call") return undefined;
  const callee = target.value.callee.importedName ?? target.value.callee.name;
  if (
    (callee !== "agent" && callee !== "convexAgent") ||
    !target.value.callee.moduleSpecifier ||
    !agentModules.has(target.value.callee.moduleSpecifier)
  )
    return undefined;
  const config = target.value.args[0];
  const explicitId =
    config?.kind === "object"
      ? staticStringValue(
          staticObjectPropertyValue(config, "id"),
          target.initializers,
        )
      : undefined;
  const identity = explicitId ?? target.symbol.split(".").at(-1);
  return identity ? `agent:${ctx.source.safeId(identity)}` : undefined;
}
