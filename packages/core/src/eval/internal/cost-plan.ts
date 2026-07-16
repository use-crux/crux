/** Conservative external-action cost estimation and admission. @internal */

import { resolveEvalScorers } from "./scorer-plan";
import type { EvalCostConfirmationPort, EvalCostEstimator } from "./ports";
import type { EvalPlannedCell } from "./types";
import type {
  EvalCostAction,
  EvalCostAdmission,
  EvalCostEstimationRequest,
  EvalCostEstimate,
  EvalCostPlan,
  EvalCostPlanOptions,
} from "./cost-types";

/** Structured cost-admission failure raised before any external work. */
export class EvalCostAdmissionError extends Error {
  readonly name = "EvalCostAdmissionError";
  readonly reason: Exclude<
    EvalCostAdmission,
    { readonly status: "admitted" }
  >["reason"];

  constructor(admission: Exclude<EvalCostAdmission, { status: "admitted" }>) {
    super(renderCostAdmission(admission));
    this.reason = admission.reason;
  }
}

/** Estimate every non-reused external action, then admit as one plan. */
export async function createEvalCostPlan(input: {
  readonly cells: readonly EvalPlannedCell[];
  readonly rawScorers: unknown;
  readonly options: EvalCostPlanOptions;
  readonly estimator?: EvalCostEstimator;
  readonly confirmation?: EvalCostConfirmationPort;
}): Promise<EvalCostPlan> {
  assertMaxCost(input.options.maxCostUsd);
  const requests = collectCostRequests(input.cells, input.rawScorers);
  const actions = Object.freeze(
    await Promise.all(
      requests.map(async (request) =>
        Object.freeze({
          ...publicActionFields(request),
          estimate: normalizeEstimate(
            input.estimator === undefined
              ? { kind: "none" }
              : await input.estimator.estimate(request),
          ),
        }),
      ),
    ),
  );
  const knownMaximumUsd = actions.reduce(
    (total, action) =>
      total +
      (action.estimate.kind === "known" ? action.estimate.maximumUsd : 0),
    0,
  );
  const unknownActionCount = actions.filter(
    (action) => action.estimate.kind === "unknown",
  ).length;
  const admission = await admit({
    actions,
    knownMaximumUsd,
    unknownActionCount,
    options: input.options,
    confirmation: input.confirmation,
  });
  return Object.freeze({
    actions,
    knownMaximumUsd,
    unknownActionCount,
    admission,
    planOnly: input.options.plan === true,
  });
}

/** Refuse blocked, unconfirmed, or display-only plans before execution. */
export function assertEvalCostAdmitted(cost: EvalCostPlan): void {
  if (cost.planOnly) {
    throw new EvalCostAdmissionError({
      status: "confirmation_required",
      reason: "unknown_cost",
    });
  }
  if (cost.admission.status !== "admitted") {
    throw new EvalCostAdmissionError(cost.admission);
  }
}

function collectCostRequests(
  cells: readonly EvalPlannedCell[],
  rawScorers: unknown,
): readonly EvalCostEstimationRequest[] {
  const scorers = resolveEvalScorers(rawScorers);
  const requests: EvalCostEstimationRequest[] = [];
  for (const cell of cells) {
    if (cell.action.kind === "execute") {
      requests.push({
        actionId: `${cell.caseId}:${cell.variant}:${cell.trial}:task`,
        kind: "task",
        caseId: cell.caseId,
        variant: cell.variant,
        trial: cell.trial,
        task: cell.task,
        overrides: cell.overrides,
        input: cell.input,
        ...(cell.call !== undefined ? { call: cell.call } : {}),
      });
    }
    let managedIndex = 0;
    for (const [index, scorer] of scorers.entries()) {
      if (scorer.costClass === "code") continue;
      if (scorer.costClass === "model") {
        const action = cell.scorerActions[managedIndex++];
        if (action === undefined || action.kind === "reuse") continue;
        requests.push({
          actionId: action.actionId,
          kind: "scorer",
          caseId: cell.caseId,
          variant: cell.variant,
          trial: cell.trial,
          scorerName: action.scorerName,
          task: cell.task,
          overrides: cell.overrides,
          input: cell.input,
          ...(cell.call !== undefined ? { call: cell.call } : {}),
          scorer,
        });
        continue;
      }
      const scorerName = scorer.scorerName ?? scorer.name ?? "(dynamic)";
      requests.push({
        actionId: `${cell.caseId}:${cell.variant}:${cell.trial}:unknown-score:${index}:${scorerName}`,
        kind: "scorer",
        caseId: cell.caseId,
        variant: cell.variant,
        trial: cell.trial,
        scorerName,
        task: cell.task,
        overrides: cell.overrides,
        input: cell.input,
        ...(cell.call !== undefined ? { call: cell.call } : {}),
        scorer,
      });
    }
  }
  return Object.freeze(requests);
}

function publicActionFields(
  request: EvalCostEstimationRequest,
): Omit<EvalCostAction, "estimate"> {
  return {
    actionId: request.actionId,
    kind: request.kind,
    caseId: request.caseId,
    variant: request.variant,
    trial: request.trial,
    ...(request.scorerName !== undefined
      ? { scorerName: request.scorerName }
      : {}),
  };
}

async function admit(input: {
  readonly actions: readonly EvalCostAction[];
  readonly knownMaximumUsd: number;
  readonly unknownActionCount: number;
  readonly options: EvalCostPlanOptions;
  readonly confirmation?: EvalCostConfirmationPort;
}): Promise<EvalCostAdmission> {
  if (input.actions.every((action) => !isBillable(action.estimate))) {
    return Object.freeze({
      status: "admitted",
      costControl: "not_required",
    });
  }
  if (input.options.maxCostUsd !== undefined) {
    if (input.unknownActionCount > 0) {
      return Object.freeze({
        status: "blocked",
        reason: "unknown_cost_under_cap",
      });
    }
    if (exceeds(input.knownMaximumUsd, input.options.maxCostUsd)) {
      return Object.freeze({
        status: "blocked",
        reason: "max_cost_exceeded",
      });
    }
    return Object.freeze({
      status: "admitted",
      costControl: "max_cost",
      maxCostUsd: input.options.maxCostUsd,
    });
  }
  if (input.options.interactive !== true) {
    return Object.freeze({
      status: "blocked",
      reason: "max_cost_required",
    });
  }
  if (input.unknownActionCount === 0) {
    return Object.freeze({ status: "admitted", costControl: "unknown" });
  }
  if (input.options.plan === true) {
    return Object.freeze({
      status: "confirmation_required",
      reason: "unknown_cost",
    });
  }
  if (input.confirmation === undefined) {
    return Object.freeze({
      status: "blocked",
      reason: "confirmation_required",
    });
  }
  return (await input.confirmation.confirm({
    knownMaximumUsd: input.knownMaximumUsd,
    unknownActions: Object.freeze(
      input.actions.filter((action) => action.estimate.kind === "unknown"),
    ),
  }))
    ? Object.freeze({ status: "admitted", costControl: "unknown" })
    : Object.freeze({ status: "blocked", reason: "confirmation_declined" });
}

function isBillable(estimate: EvalCostEstimate): boolean {
  return (
    estimate.kind === "unknown" ||
    (estimate.kind === "known" && estimate.maximumUsd > 0)
  );
}

function exceeds(total: number, limit: number): boolean {
  const tolerance = Number.EPSILON * Math.max(1, total, limit) * 16;
  return total - limit > tolerance;
}

function normalizeEstimate(estimate: EvalCostEstimate): EvalCostEstimate {
  if (estimate.kind !== "known") return Object.freeze({ ...estimate });
  if (!Number.isFinite(estimate.maximumUsd) || estimate.maximumUsd < 0) {
    throw new TypeError("Eval cost estimates must be finite and non-negative.");
  }
  return Object.freeze({ ...estimate });
}

function assertMaxCost(maxCostUsd: number | undefined): void {
  if (
    maxCostUsd !== undefined &&
    (!Number.isFinite(maxCostUsd) || maxCostUsd < 0)
  ) {
    throw new TypeError("maxCostUsd must be finite and non-negative.");
  }
}

function renderCostAdmission(
  admission: Exclude<EvalCostAdmission, { status: "admitted" }>,
): string {
  return `Eval cost admission failed: ${admission.reason}.`;
}
