import type { ProjectSourceRef } from "@use-crux/core/project-index";
import type { InternalStaticRecordContext } from "../static-index/compatibility/syntax-record-bridge/native-context";
import {
  createStaticRecordSourceResolver,
  staticRecordProjectSourceRef,
  type ResolvedStaticRecordSource,
} from "../static-index/compatibility/syntax-record-bridge/source-resolver";
import type {
  StaticFunctionCallValue,
  StaticSyntaxValue,
} from "../static-index/syntax/record/types";
import {
  resolveStaticSyntaxValue,
  type StaticSyntaxInitializerMap,
} from "../static-index/syntax/record/value";
import type { PrimitiveDataAccessRef } from "./data-access";
import {
  dataAccessKindForMethod,
  dataAccessOperationForMethod,
} from "./data-access-manifest";

/** Returns data-access evidence visible from a statically resolved flow step target. */
export function dataAccessesForStepTarget(
  target: StaticSyntaxValue,
  initializers: StaticSyntaxInitializerMap,
): readonly PrimitiveDataAccessRef[] {
  const resolved = resolveStaticSyntaxValue(target, initializers);
  return resolved?.kind === "function"
    ? [
        ...dataAccessRefsFromCalls(resolved.calls),
        ...helperDataAccessRefsFromCalls(
          resolved.calls,
          initializers,
          new Set(),
          1,
        ),
      ]
    : [];
}

/** Returns source refs for a statically resolved flow step target and its direct helpers. */
export function sourceRefsForTarget(
  ctx: InternalStaticRecordContext,
  definitionId: string,
  targetVariable: string,
): readonly ProjectSourceRef[] {
  const resolver = createStaticRecordSourceResolver({
    record: ctx.record,
    initializers: ctx.initializers,
    initializerRecords: ctx.initializerRecords,
    ...(ctx.recordsByFile ? { recordsByFile: ctx.recordsByFile } : {}),
  });
  const resolved = resolver.resolveValue({
    kind: "identifier",
    name: targetVariable,
  });
  if (!resolved) return [];
  return [
    staticRecordProjectSourceRef({
      definitionId,
      role: "handler",
      property: "step",
      resolved,
    }),
    ...helperSourceRefsForResolvedTarget(resolver, definitionId, resolved),
  ];
}

function dataAccessRefsFromCalls(
  calls: readonly StaticFunctionCallValue[],
): readonly PrimitiveDataAccessRef[] {
  return calls.flatMap((call): readonly PrimitiveDataAccessRef[] => {
    const kind = dataAccessKindForMethod(call.callee.name);
    const targetVariable = receiverIdentifier(call.receiver);
    if (!kind || !targetVariable) return [];
    const key = dataAccessKey(call.args[0]);
    return [
      {
        kind,
        targetVariable,
        operation: dataAccessOperationForMethod(call.callee.name, kind),
        targetKind: dataAccessTargetKind(targetVariable),
        ...(key ? { key } : {}),
        source: call.source,
      },
    ];
  });
}

function helperDataAccessRefsFromCalls(
  calls: readonly StaticFunctionCallValue[],
  initializers: StaticSyntaxInitializerMap,
  seen: Set<string>,
  depth: number,
): readonly PrimitiveDataAccessRef[] {
  if (depth <= 0) return [];
  return calls.flatMap((call): readonly PrimitiveDataAccessRef[] => {
    const symbol = call.receiver
      ? undefined
      : (call.callee.localName ?? call.callee.name);
    if (!symbol || seen.has(symbol)) return [];
    seen.add(symbol);
    const resolved = resolveStaticSyntaxValue(
      { kind: "identifier", name: symbol },
      initializers,
    );
    if (resolved?.kind !== "function") return [];
    return [
      ...dataAccessRefsFromCalls(resolved.calls),
      ...helperDataAccessRefsFromCalls(
        resolved.calls,
        initializers,
        seen,
        depth - 1,
      ),
    ];
  });
}

function helperSourceRefsForResolvedTarget(
  resolver: ReturnType<typeof createStaticRecordSourceResolver>,
  definitionId: string,
  resolved: ResolvedStaticRecordSource,
): readonly ProjectSourceRef[] {
  if (resolved.value.kind !== "function") return [];
  const seen = new Set<string>();
  return resolved.value.calls.flatMap((call): readonly ProjectSourceRef[] => {
    const symbol = call.receiver
      ? undefined
      : (call.callee.localName ?? call.callee.name);
    if (!symbol || seen.has(symbol)) return [];
    seen.add(symbol);
    const helper = resolver.resolveFrom(resolved, {
      kind: "identifier",
      name: symbol,
    });
    if (!helper || helper.value.kind !== "function") return [];
    return [
      staticRecordProjectSourceRef({
        definitionId,
        role: "helper",
        property: symbol,
        resolved: helper,
      }),
    ];
  });
}

function receiverIdentifier(
  value: StaticSyntaxValue | undefined,
): string | undefined {
  return value?.kind === "identifier" ? value.name : undefined;
}

function dataAccessKey(
  value: StaticSyntaxValue | undefined,
): string | undefined {
  if (value?.kind !== "literal") return undefined;
  return typeof value.value === "string" || typeof value.value === "number"
    ? String(value.value)
    : undefined;
}

function dataAccessTargetKind(
  targetVariable: string,
): NonNullable<PrimitiveDataAccessRef["targetKind"]> | undefined {
  const normalized = targetVariable.toLowerCase();
  if (normalized.includes("blackboard") || normalized.includes("board"))
    return "blackboard";
  if (
    normalized.includes("workspace") ||
    normalized.includes("file") ||
    normalized.includes("fs")
  )
    return "workspace";
  if (normalized.includes("store")) return "store";
  if (normalized.includes("block")) return "block";
  if (
    normalized.includes("memory") ||
    normalized.includes("mem") ||
    normalized.includes("state")
  )
    return "memory";
  return undefined;
}
