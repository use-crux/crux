import type {
  MutableToolOutcome,
  MutableWorkOutcome,
  OwnerState,
} from "./internal";
import type { StatisticsFact } from "./types";

/** Reject facts that would violate aggregate state before mutation. @internal */
export function assertFactCanApply(
  state: OwnerState,
  fact: StatisticsFact,
): void {
  switch (fact.kind) {
    case "model-call":
      if (fact.outcome !== "started")
        assertModelCallAvailable(state, fact.model);
      return;
    case "transport-retry":
      assertModelTarget(state, fact.model);
      return;
    case "tool":
      if (["succeeded", "failed", "cancelled"].includes(fact.outcome)) {
        assertToolCallAvailable(state, fact.name);
      }
      return;
    case "work-state":
      if (fact.from === fact.to) {
        throw new TypeError("Statistics ledger impossible Work transition.");
      }
      assertWorkGauge(state, fact.target, fact.from);
      return;
    case "work-outcome":
      assertWorkGauge(state, fact.target, fact.from);
      return;
    case "approval":
      if (
        fact.outcome !== "requested" &&
        state.approvals.approved +
          state.approvals.denied +
          state.approvals.expired >=
          state.approvals.requested
      ) {
        throw new TypeError("Statistics ledger approval outcome underflow.");
      }
      return;
    case "lifecycle":
      if (
        fact.event === "resumption" &&
        state.lifecycle.resumptions >= state.lifecycle.suspensions
      ) {
        throw new TypeError("Statistics ledger resumption underflow.");
      }
  }
}

function assertWorkGauge(
  state: OwnerState,
  target: string,
  from: keyof MutableWorkOutcome["current"],
): void {
  const attributed =
    state.workByTarget.get(target) ??
    (state.workByTarget.size === 64 ? state.otherWork : undefined);
  if (
    state.work.current[from] <= 0 ||
    !attributed ||
    attributed.current[from] <= 0
  ) {
    throw new TypeError("Statistics ledger Work gauge underflow.");
  }
}

function assertModelCallAvailable(state: OwnerState, model: string): void {
  assertModelTarget(state, model);
  const settled =
    state.modelCalls.succeeded +
    state.modelCalls.failed +
    state.modelCalls.cancelled;
  if (settled >= state.modelCalls.started) {
    throw new TypeError("Statistics ledger model-call outcome underflow.");
  }
}

function assertModelTarget(state: OwnerState, model: string): void {
  if (!state.models.has(model) && !state.otherModels?.calls) {
    throw new TypeError("Statistics ledger fact has no sealed model call.");
  }
}

function assertToolCallAvailable(state: OwnerState, name: string): void {
  const attributed =
    state.toolsByName.get(name) ??
    (state.toolsByName.size === 64 ? state.otherTools : undefined);
  if (
    !hasPendingToolCall(state.tools) ||
    !attributed ||
    !hasPendingToolCall(attributed)
  ) {
    throw new TypeError("Statistics ledger Tool outcome underflow.");
  }
}

function hasPendingToolCall(value: MutableToolOutcome): boolean {
  return value.called > value.succeeded + value.failed + value.cancelled;
}
