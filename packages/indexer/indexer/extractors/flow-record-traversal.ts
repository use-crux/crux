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
  FlowNondeterministicEvidence,
  FlowRuntimeUsageEvidence,
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
    runtimeUsages: roots.flatMap(runtimeUsages),
    nondeterministicCalls: roots.flatMap(nondeterministicCalls),
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

function runtimeUsages(
  root: StaticFunctionValue,
): readonly FlowRuntimeUsageEvidence[] {
  const runtimeBindings = firstParameterRuntimeBindings(root)
  return root.calls.flatMap((call): readonly FlowRuntimeUsageEvidence[] => {
    const method = runtimeMethod(call, runtimeBindings);
    if (!method) return [];
    const payload =
      method === "defer" ? call.args[1] : method === "after" ? call.args[2] : undefined;
    return [
      {
        method,
        source: call.source,
        ...(method === "defer" && call.args[0]?.kind === "function"
          ? { closureTarget: true }
          : {}),
        ...(payload && nonSerializablePayload(payload)
          ? { nonSerializablePayload: nonSerializablePayload(payload) }
          : {}),
      },
    ];
  });
}

function runtimeMethod(
  call: StaticFunctionCallValue,
  runtimeBindings: ReadonlyMap<string, FlowRuntimeUsageEvidence["method"] | "scope">,
): FlowRuntimeUsageEvidence["method"] | undefined {
  const receiver = staticIdentifierName(call.receiver);
  if (receiver && runtimeBindings.get(receiver) !== "scope") return undefined;
  if (!receiver) {
    const directBinding = runtimeBindings.get(call.callee.localName ?? call.callee.name);
    return directBinding && directBinding !== "scope" ? directBinding : undefined;
  }
  return call.callee.name === "waitFor" ||
    call.callee.name === "defer" ||
    call.callee.name === "after" ||
    call.callee.name === "untilIdle"
    ? call.callee.name
    : undefined;
}

function firstParameterRuntimeBindings(
  root: StaticFunctionValue,
): ReadonlyMap<string, FlowRuntimeUsageEvidence["method"] | "scope"> {
  const bindings = new Map<string, FlowRuntimeUsageEvidence["method"] | "scope">();
  for (const binding of root.firstParameterBindings ?? []) {
    const method = runtimeBindingMethod(binding.propertyName ?? binding.name);
    if (method) {
      bindings.set(binding.name, method);
    } else if (!binding.propertyName) {
      bindings.set(binding.name, "scope");
    }
  }
  return bindings;
}

function runtimeBindingMethod(
  name: string | undefined,
): FlowRuntimeUsageEvidence["method"] | undefined {
  return name === "waitFor" || name === "defer" || name === "after" || name === "untilIdle"
    ? name
    : undefined;
}

function nondeterministicCalls(
  root: StaticFunctionValue,
): readonly FlowNondeterministicEvidence[] {
  return root.calls.flatMap((call): readonly FlowNondeterministicEvidence[] => {
    if (call.callee.name === "now" && staticIdentifierName(call.receiver) === "Date") {
      return [{ expression: "Date.now", source: call.source }];
    }
    if (
      call.callee.name === "random" &&
      staticIdentifierName(call.receiver) === "Math"
    ) {
      return [{ expression: "Math.random", source: call.source }];
    }
    return [];
  });
}

function staticIdentifierName(
  value: StaticSyntaxValue | undefined,
): string | undefined {
  return value?.kind === "identifier" ? value.name : undefined;
}

function nonSerializablePayload(
  value: StaticSyntaxValue,
): string | undefined {
  if (value.kind === "function") return "function";
  if (value.kind === "unsupported") return value.syntaxKind;
  return undefined;
}

function literalString(
  value: StaticSyntaxValue | undefined,
): string | undefined {
  return value?.kind === "literal" && typeof value.value === "string"
    ? value.value
    : undefined;
}
