import type {
  StaticFunctionCallValue,
  StaticSyntaxValue,
} from "../../syntax/record/types";
import {
  resolveStaticSyntaxValue,
  type StaticSyntaxInitializerMap,
} from "../../syntax/record/value";
import type { PrimitiveDataAccessRef } from "../../../extractors/data-access";
import {
  dataAccessKindForMethod,
  dataAccessOperationForMethod,
} from "../../../extractors/data-access-manifest";

/** Derives visible data-access facts from normalized syntax-record values. */
export function staticRecordDataAccessRefsFromValue(
  value: StaticSyntaxValue | undefined,
  initializers: StaticSyntaxInitializerMap,
  maxHelperDepth = 1,
): readonly PrimitiveDataAccessRef[] {
  const calls = callsForValue(
    resolveStaticSyntaxValue(value, initializers) ?? value,
  );
  return [
    ...dataAccessRefsFromCalls(calls),
    ...helperDataAccessRefsFromCalls(
      calls,
      initializers,
      new Set(),
      maxHelperDepth,
    ),
  ];
}

function callsForValue(
  value: StaticSyntaxValue | undefined,
): readonly StaticFunctionCallValue[] {
  if (!value) return [];
  switch (value.kind) {
    case "function":
      return value.calls;
    case "call":
      return [
        {
          callee: value.callee,
          ...(value.receiver ? { receiver: value.receiver } : {}),
          args: value.args,
          source: value.source,
          ...(value.snippet ? { snippet: value.snippet } : {}),
        },
        ...value.args.flatMap(callsForValue),
      ];
    case "array":
      return value.elements.flatMap(callsForValue);
    case "object":
      return value.properties.flatMap((property) =>
        callsForValue(property.value),
      );
    case "template":
      return value.expressions.flatMap(callsForValue);
    default:
      return [];
  }
}

function dataAccessRefsFromCalls(
  calls: readonly StaticFunctionCallValue[],
): readonly PrimitiveDataAccessRef[] {
  return calls.flatMap((call): readonly PrimitiveDataAccessRef[] => {
    const kind = dataAccessKindForMethod(call.callee.name);
    const targetVariable = receiverIdentifier(call.receiver);
    if (!kind || !targetVariable) return [];
    const key = dataAccessKey(call.args[0]);
    const targetKind = dataAccessTargetKind(targetVariable);
    return [
      {
        kind,
        targetVariable,
        operation: dataAccessOperationForMethod(call.callee.name, kind),
        ...(targetKind ? { targetKind } : {}),
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
  if (normalized.includes("record")) return "storage.recordStore";
  if (normalized.includes("vector")) return "storage.vectorStore";
  if (normalized.includes("blob")) return "storage.blobStore";
  if (normalized.includes("storage")) return "storage.bundle";
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
