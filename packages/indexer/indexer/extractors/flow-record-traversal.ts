import type { InternalStaticRecordContext } from "../static-index/compatibility/syntax-record-bridge/native-context";
import type {
  StaticFunctionCallValue,
  StaticFunctionValue,
  StaticSyntaxValue,
} from "../static-index/syntax/record/types";
import {
  resolveStaticSyntaxValue,
  staticObjectPropertyValue,
  staticObjectValue,
  type StaticSyntaxInitializerMap,
} from "../static-index/syntax/record/value";
import {
  dataAccessesForStepTarget,
  sourceRefsForTarget,
} from "./flow-record-data-access";
import { isObjectStyleFlowCall } from "./flow-record-options";
import type {
  FlowStepEvidence,
  FlowSuspensionEvidence,
  FlowTraversalEvidence,
} from "./flow-facts";

/** Builds normalized flow traversal evidence from syntax-record function bodies. */
export function recordFlowTraversal(
  ctx: InternalStaticRecordContext,
  flowDefinitionKey: string,
  safeId: (value: string) => string,
): FlowTraversalEvidence {
  const roots = flowFunctionRoots(ctx);
  const steps = roots.flatMap((root) =>
    root.calls.flatMap((call) =>
      flowStepRefForCall(ctx, flowDefinitionKey, safeId, call),
    ),
  );
  const stepNames = [...new Set(steps.map((step) => step.name))];
  return {
    steps,
    suspensions: flowSuspensionRefs(roots, stepNames[stepNames.length - 1]),
  };
}

function flowFunctionRoots(
  ctx: InternalStaticRecordContext,
): readonly StaticFunctionValue[] {
  if (ctx.match.kind !== "call") return [];
  if (isObjectStyleFlowCall(ctx) && ctx.objectArg) {
    return functionValues(
      staticObjectPropertyValue(ctx.objectArg, "handler"),
      ctx.initializers,
    );
  }
  return ctx.match.args
    .slice(1)
    .flatMap((arg) => flowFunctionValues(arg, ctx.initializers));
}

function flowFunctionValues(
  value: StaticSyntaxValue,
  initializers: StaticSyntaxInitializerMap,
): readonly StaticFunctionValue[] {
  const object = staticObjectValue(value, initializers);
  if (object) {
    return functionValues(
      staticObjectPropertyValue(object, "handler"),
      initializers,
    );
  }
  return functionValues(value, initializers);
}

function functionValues(
  value: StaticSyntaxValue | undefined,
  initializers: StaticSyntaxInitializerMap,
): readonly StaticFunctionValue[] {
  const resolved = resolveStaticSyntaxValue(value, initializers);
  return resolved?.kind === "function" ? [resolved] : [];
}

function flowStepRefForCall(
  ctx: InternalStaticRecordContext,
  flowDefinitionKey: string,
  safeId: (value: string) => string,
  call: StaticFunctionCallValue,
): readonly FlowStepEvidence[] {
  if (call.callee.name !== "step") return [];
  const name = literalString(call.args[0]);
  if (!name) return [];
  const target = call.args[1];
  const targetVariable =
    target?.kind === "identifier" ? target.name : undefined;
  const stepDefinitionId = `flow.step:${safeId(flowDefinitionKey)}:${safeId(name)}`;
  return [
    {
      name,
      ...(targetVariable ? { targetVariable } : {}),
      dataAccesses: target
        ? dataAccessesForStepTarget(target, ctx.initializers)
        : [],
      sourceRefs: targetVariable
        ? sourceRefsForTarget(ctx, stepDefinitionId, targetVariable)
        : [],
    },
  ];
}

function flowSuspensionRefs(
  roots: readonly StaticFunctionValue[],
  fallbackStepName: string | undefined,
): readonly FlowSuspensionEvidence[] {
  const refs: FlowSuspensionEvidence[] = [];
  let currentStepName: string | undefined;
  for (const root of roots) {
    for (const call of root.calls) {
      currentStepName = flowStepName(call) ?? currentStepName;
      const suspension = flowSuspensionForCall(
        call,
        currentStepName ?? fallbackStepName,
      );
      if (suspension) refs.push(suspension);
    }
  }
  return refs;
}

function flowStepName(call: StaticFunctionCallValue): string | undefined {
  return call.callee.name === "step" ? literalString(call.args[0]) : undefined;
}

function flowSuspensionForCall(
  call: StaticFunctionCallValue,
  stepName: string | undefined,
): FlowSuspensionEvidence | undefined {
  const signal = literalString(call.args[0]);
  return signal &&
    (call.callee.name === "waitFor" || call.callee.name === "suspend")
    ? { signal, ...(stepName ? { stepName } : {}) }
    : undefined;
}

function literalString(
  value: StaticSyntaxValue | undefined,
): string | undefined {
  return value?.kind === "literal" && typeof value.value === "string"
    ? value.value
    : undefined;
}
