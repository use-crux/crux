import {
  emptySessionInputOutcome,
  emptyToolOutcome,
  emptyWorkOutcome,
  type MutableSessionInputOutcome,
  type MutableToolOutcome,
  type MutableUsage,
  type MutableWorkOutcome,
  type OwnerState,
} from "./internal";
import type { StatisticsFact, StatisticsUsageReport } from "./types";

export function applyFact(
  state: OwnerState,
  fact: StatisticsFact,
  at: Date,
): void {
  state.updatedAt = new Date(at);
  switch (fact.kind) {
    case "model-call":
      applyModelCall(state, fact);
      return;
    case "transport-retry":
      applyTransportRetry(state, fact);
      return;
    case "tool":
      applyTool(state.tools, fact.outcome);
      applyTool(toolTarget(state, fact.name), fact.outcome);
      return;
    case "work-accepted":
      applyWorkAccepted(state.work, fact.state);
      applyWorkAccepted(workTarget(state, fact.target), fact.state);
      return;
    case "work-state":
      applyWorkState(state.work, fact.from, fact.to);
      applyWorkState(workTarget(state, fact.target), fact.from, fact.to);
      return;
    case "work-outcome":
      applyWorkOutcome(state.work, fact.from, fact.outcome);
      applyWorkOutcome(workTarget(state, fact.target), fact.from, fact.outcome);
      return;
    case "failure":
      state.failures[fact.failureKind] += 1;
      return;
    case "approval":
      increment(state.approvals, fact.outcome);
      return;
    case "lifecycle":
      increment(state.lifecycle, lifecycleKey(fact.event));
      return;
    case "session-input":
      increment(state.inputs, fact.outcome);
      increment(sessionInputTarget(state, fact.identity), fact.outcome);
      return;
    case "timing":
      state.activeTimeMs += fact.activeTimeMs;
      state.suspendedTimeMs += fact.suspendedTimeMs;
      if (fact.completed) state.completedAt = new Date(at);
  }
}

function sessionInputTarget(
  state: OwnerState,
  identity: string,
): MutableSessionInputOutcome {
  const current = state.inputsByIdentity.get(identity);
  if (current) return current;
  if (state.inputsByIdentity.size < 64) {
    return mapValue(state.inputsByIdentity, identity, emptySessionInputOutcome);
  }
  return (state.otherInputs ??= emptySessionInputOutcome());
}

function applyTransportRetry(
  state: OwnerState,
  fact: Extract<StatisticsFact, { kind: "transport-retry" }>,
): void {
  let usage = state.models.get(fact.model);
  if (!usage) {
    usage = state.otherModels ??= emptyUsage();
  }
  increment(state.modelCalls, "transportRetries");
  usage.usageAttempts += 1;
  state.usage.usageAttempts += 1;
  if (fact.usage) {
    addUsage(usage, fact.usage);
    addUsage(state.usage, fact.usage);
  }
}

function applyModelCall(
  state: OwnerState,
  fact: Extract<StatisticsFact, { kind: "model-call" }>,
): void {
  const usage = modelTarget(state, fact.model);
  if (fact.outcome === "started") {
    increment(state.modelCalls, "started");
    usage.calls += 1;
    usage.usageAttempts += 1;
    state.usage.calls += 1;
    state.usage.usageAttempts += 1;
    return;
  }
  increment(state.modelCalls, fact.outcome);
  if (fact.usage) {
    addUsage(usage, fact.usage);
    addUsage(state.usage, fact.usage);
  }
}

function modelTarget(state: OwnerState, model: string): MutableUsage {
  const current = state.models.get(model);
  if (current) return current;
  if (state.models.size < 64) {
    return mapValue(state.models, model, emptyUsage);
  }
  return (state.otherModels ??= emptyUsage());
}

function toolTarget(state: OwnerState, name: string): MutableToolOutcome {
  const current = state.toolsByName.get(name);
  if (current) return current;
  if (state.toolsByName.size < 64) {
    return mapValue(state.toolsByName, name, emptyToolOutcome);
  }
  return (state.otherTools ??= emptyToolOutcome());
}

function workTarget(state: OwnerState, target: string): MutableWorkOutcome {
  const current = state.workByTarget.get(target);
  if (current) return current;
  if (state.workByTarget.size < 64) {
    return mapValue(state.workByTarget, target, emptyWorkOutcome);
  }
  return (state.otherWork ??= emptyWorkOutcome());
}

function emptyUsage(): MutableUsage {
  return { calls: 0, usageAttempts: 0, tokenReports: 0, costReports: 0 };
}

function addUsage(target: MutableUsage, report: StatisticsUsageReport): void {
  const tokenKeys = [
    "inputTokens",
    "outputTokens",
    "totalTokens",
    "cachedInputTokens",
    "reasoningTokens",
  ] as const;
  if (tokenKeys.some((key) => report[key] !== undefined))
    target.tokenReports += 1;
  if (report.costUsd !== undefined) target.costReports += 1;
  for (const key of [...tokenKeys, "costUsd"] as const) {
    const value = report[key];
    if (value !== undefined) target[key] = (target[key] ?? 0) + value;
  }
}

function applyTool(
  target: MutableToolOutcome,
  outcome: "called" | "succeeded" | "failed" | "denied" | "cancelled",
): void {
  increment(target, outcome);
}

function applyWorkAccepted(
  target: MutableWorkOutcome,
  state: keyof MutableWorkOutcome["current"],
): void {
  increment(target, "started");
  target.current[state] += 1;
}

function applyWorkState(
  target: MutableWorkOutcome,
  from: keyof MutableWorkOutcome["current"],
  to: keyof MutableWorkOutcome["current"],
): void {
  target.current[from] -= 1;
  target.current[to] += 1;
}

function applyWorkOutcome(
  target: MutableWorkOutcome,
  from: keyof MutableWorkOutcome["current"],
  outcome: "completed" | "failed" | "cancelled" | "detached",
): void {
  target.current[from] -= 1;
  increment(target, outcome);
}

function lifecycleKey(
  event: Extract<StatisticsFact, { kind: "lifecycle" }>["event"],
): keyof OwnerState["lifecycle"] {
  return (
    {
      suspension: "suspensions",
      resumption: "resumptions",
      cancellation: "cancellations",
      "steering-input": "steeringInputs",
    } as const
  )[event];
}

function increment<T extends object, K extends keyof T>(
  target: T,
  key: K,
): void {
  target[key] = ((target[key] as number) + 1) as T[K];
}

function mapValue<K, V>(map: Map<K, V>, key: K, create: () => V): V {
  const current = map.get(key);
  if (current) return current;
  const value = create();
  map.set(key, value);
  return value;
}
