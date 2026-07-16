/** Atomic hard-cap reservations for admitted Eval cost plans. @internal */

import type { EvalReservationPort } from "./ports";
import type { EvalCostAction, EvalCostPlan } from "./cost-types";
import type { EvalPlan, EvalRun } from "./types";

export class EvalCostReservationError extends Error {
  readonly name = "EvalCostReservationError";
  readonly reason: "reservation_unavailable" | "budget_exhausted";

  constructor(reason: "reservation_unavailable" | "budget_exhausted") {
    super(`Eval cost reservation failed: ${reason}.`);
    this.reason = reason;
  }
}

/** Reserve every capped action before external scheduling begins. */
export async function reserveEvalCostPlan(
  cost: EvalCostPlan,
  port: EvalReservationPort | undefined,
  scope: string,
): Promise<EvalCostLease> {
  const actions = cost.actions.filter(
    (action) =>
      action.estimate.kind === "known" && action.estimate.maximumUsd > 0,
  );
  if (
    cost.admission.status !== "admitted" ||
    cost.admission.costControl !== "max_cost" ||
    actions.length === 0
  ) {
    return EMPTY_LEASE;
  }
  if (port === undefined) {
    throw new EvalCostReservationError("reservation_unavailable");
  }
  const reserved: EvalCostAction[] = [];
  for (const action of actions) {
    const estimate = action.estimate;
    if (estimate.kind !== "known") continue;
    const result = await port.reserve({
      reservationId: reservationId(scope, action.actionId),
      actionId: action.actionId,
      maximumUsd: estimate.maximumUsd,
    });
    if (result.status === "rejected") {
      await releaseAll(port, reserved, scope);
      throw new EvalCostReservationError("budget_exhausted");
    }
    reserved.push(action);
  }
  return createLease(port, reserved, scope);
}

export interface EvalCostLease {
  settle(plan: EvalPlan, run: EvalRun): Promise<void>;
  fail(): Promise<void>;
}

function createLease(
  port: EvalReservationPort,
  actions: readonly EvalCostAction[],
  scope: string,
): EvalCostLease {
  const remaining = new Map(actions.map((action) => [action.actionId, action]));
  return {
    async settle(plan, run) {
      for (const action of [...remaining.values()]) {
        await port.settle({
          reservationId: reservationId(scope, action.actionId),
          actualUsd: actionActualUsd(action, plan, run),
        });
        remaining.delete(action.actionId);
      }
    },
    async fail() {
      for (const action of [...remaining.values()]) {
        const maximumUsd =
          action.estimate.kind === "known" ? action.estimate.maximumUsd : 0;
        await port.settle({
          reservationId: reservationId(scope, action.actionId),
          actualUsd: maximumUsd,
        });
        remaining.delete(action.actionId);
      }
    },
  };
}

function actionActualUsd(
  action: EvalCostAction,
  plan: EvalPlan,
  run: EvalRun,
): number {
  const maximumUsd =
    action.estimate.kind === "known" ? action.estimate.maximumUsd : 0;
  const cell = run.cells.find(
    (candidate) =>
      candidate.caseId === action.caseId &&
      candidate.variant === action.variant &&
      candidate.trial === action.trial,
  );
  if (cell === undefined) return maximumUsd;
  if (action.kind === "task") {
    if (cell.task.status === "reused") return 0;
    return cell.metrics.costUsd ?? maximumUsd;
  }
  const plannedCell = plan.cells.find(
    (candidate) =>
      candidate.caseId === action.caseId &&
      candidate.variant === action.variant &&
      candidate.trial === action.trial,
  );
  const scorerIndex = plannedCell?.scorerActions.findIndex(
    (candidate) => candidate.actionId === action.actionId,
  );
  const managedScores = cell.scores.filter((score) => "work" in score);
  const score =
    scorerIndex === undefined ? undefined : managedScores[scorerIndex];
  if (
    score !== undefined &&
    (score.work.status === "reused" || score.work.status === "not_called")
  ) {
    return 0;
  }
  return maximumUsd;
}

async function releaseAll(
  port: EvalReservationPort,
  actions: readonly EvalCostAction[],
  scope: string,
): Promise<void> {
  for (const action of actions) {
    await port.settle({
      reservationId: reservationId(scope, action.actionId),
      actualUsd: 0,
    });
  }
}

function reservationId(scope: string, actionId: string): string {
  return `eval-cost:${scope}:${actionId}`;
}

const EMPTY_LEASE: EvalCostLease = Object.freeze({
  settle: async () => undefined,
  fail: async () => undefined,
});

/** Deterministic shared in-memory reservation port for tests and local hosts. */
export function createMemoryEvalReservationPort(
  maxCostUsd: number,
): EvalReservationPort & {
  snapshot(): {
    readonly heldUsd: number;
    readonly spentUsd: number;
    readonly availableUsd: number;
  };
} {
  if (!Number.isFinite(maxCostUsd) || maxCostUsd < 0) {
    throw new TypeError("Reservation maximum must be finite and non-negative.");
  }
  const held = new Map<string, number>();
  let spentUsd = 0;
  let queue = Promise.resolve();

  const synchronize = async <T>(
    operation: () => T | Promise<T>,
  ): Promise<T> => {
    const previous = queue;
    let release!: () => void;
    queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  };

  return {
    reserve: (request) =>
      synchronize(() => {
        const existing = held.get(request.reservationId);
        if (existing !== undefined) {
          return existing === request.maximumUsd
            ? { status: "reserved" as const }
            : { status: "rejected" as const };
        }
        const heldUsd = sum(held.values());
        if (
          spentUsd + heldUsd + request.maximumUsd - maxCostUsd >
          Number.EPSILON * Math.max(1, maxCostUsd) * 16
        ) {
          return { status: "rejected" as const };
        }
        held.set(request.reservationId, request.maximumUsd);
        return { status: "reserved" as const };
      }),
    settle: (request) =>
      synchronize(() => {
        const maximum = held.get(request.reservationId);
        if (maximum === undefined) return;
        if (!Number.isFinite(request.actualUsd) || request.actualUsd < 0) {
          throw new TypeError(
            "Reservation actual must be finite and non-negative.",
          );
        }
        held.delete(request.reservationId);
        spentUsd += request.actualUsd;
      }),
    snapshot() {
      const heldUsd = sum(held.values());
      return Object.freeze({
        heldUsd,
        spentUsd,
        availableUsd: maxCostUsd - heldUsd - spentUsd,
      });
    },
  };
}

function sum(values: Iterable<number>): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}
