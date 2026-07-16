/** Portable execution facade for an immutable admitted Eval plan. @internal */

import { aggregateVariant } from "./aggregate";
import {
  executePlannedCell,
  type EvalCellExecutionResult,
} from "./execute-cell";
import { evaluateBlockingGates } from "./gates";
import type { EvalExecutionPorts } from "./ports";
import type { EvalPlan, EvalRun } from "./types";
import { assertEvalPreflightReady } from "./offline";
import { assertEvalCostAdmitted } from "./cost-plan";
import { reserveEvalCostPlan } from "./reservation";
import { compareEvalCellsToBaseline } from "./baseline";

export async function executeEvalPlan(
  plan: EvalPlan,
  ports: EvalExecutionPorts,
): Promise<EvalRun> {
  assertEvalPreflightReady(plan.evalId, plan.preflight);
  assertEvalCostAdmitted(plan.cost);
  const runId = ports.ids.next("run");
  const costLease = await reserveEvalCostPlan(
    plan.cost,
    ports.reservations,
    runId,
  );
  try {
    return await executeReservedEvalPlan(plan, ports, costLease, runId);
  } catch (error) {
    await costLease.fail();
    throw error;
  }
}

async function executeReservedEvalPlan(
  plan: EvalPlan,
  ports: EvalExecutionPorts,
  costLease: Awaited<ReturnType<typeof reserveEvalCostPlan>>,
  runId: string,
): Promise<EvalRun> {
  const startedAt = ports.clock.now();
  const results: EvalCellExecutionResult[] = [];
  for (const planned of plan.cells) {
    results.push(await executePlannedCell({ plan, planned, ports }));
  }
  const cells = Object.freeze(results.map((result) => result.cell));
  const incompleteReasons = Object.freeze([
    ...new Set(results.flatMap((result) => result.incompleteReason ?? [])),
  ]);
  const blockingVariants = Object.freeze(
    plan.arms.filter((arm) => arm.blocking).map((arm) => arm.name),
  );
  const aggregates = Object.freeze(
    Object.fromEntries(
      plan.arms.map((arm) => [
        arm.name,
        aggregateVariant(cells.filter((cell) => cell.variant === arm.name)),
      ]),
    ),
  );
  const comparison =
    ports.baseline === undefined
      ? undefined
      : compareEvalCellsToBaseline(cells, ports.baseline);
  const gates = evaluateBlockingGates(
    cells,
    blockingVariants,
    plan.gates,
    comparison,
    plan.evalId,
  );
  const actualCosts = cells.flatMap((cell) =>
    cell.metrics.costUsd === undefined ? [] : [cell.metrics.costUsd],
  );
  const actualUsd =
    actualCosts.length === 0
      ? undefined
      : actualCosts.reduce((total, cost) => total + cost, 0);
  const evidence = summarizeEvidenceWrites(results);
  const base = {
    schemaVersion: 3 as const,
    runId,
    evalId: plan.evalId,
    sourceKey: plan.sourceKey,
    startedAt,
    endedAt: ports.clock.now(),
    definitionFingerprint: plan.definitionFingerprint,
    selection: plan.selection,
    costControl:
      plan.cost.admission.status === "admitted"
        ? plan.cost.admission.costControl
        : "not_required",
    blockingVariants,
    cells,
    variants: Object.freeze(
      plan.arms.map((arm) =>
        Object.freeze({
          name: arm.name,
          fingerprint: arm.fingerprint,
          overrideKeys: arm.overrideKeys,
          blocking: arm.blocking,
        }),
      ),
    ),
    aggregates,
    ...(comparison !== undefined ? { comparison } : {}),
    gates,
    cost: Object.freeze({
      ...(actualUsd !== undefined ? { actualUsd } : {}),
      reservedMaximumUsd: plan.cost.knownMaximumUsd,
      unknownActionCount: plan.cost.unknownActionCount,
      task: Object.freeze({
        ...(actualUsd !== undefined ? { actualUsd } : {}),
      }),
      judge: Object.freeze({}),
    }),
    provenance: Object.freeze({
      task: "managed" as const,
      host: "injected" as const,
      evidenceStore:
        ports.evidenceStore === undefined
          ? ("none" as const)
          : Object.freeze({
              identity: ports.evidenceStore.identity,
              consistency: ports.evidenceStore.consistency,
              write: evidence.write,
              ...(evidence.writeReason !== undefined
                ? { writeReason: evidence.writeReason }
                : {}),
            }),
    }),
  };
  const run: EvalRun = Object.freeze(
    incompleteReasons.length === 0
      ? { ...base, status: "complete" as const, passed: gates.passed }
      : {
          ...base,
          status: "incomplete" as const,
          passed: false as const,
          reasons: incompleteReasons,
        },
  );
  await costLease.settle(plan, run);
  await ports.runStore.write(run);
  return run;
}

function summarizeEvidenceWrites(results: readonly EvalCellExecutionResult[]) {
  const attempted = results.filter(
    (result) => result.evidenceWrite !== "not_attempted",
  );
  const write = attempted.some((result) => result.evidenceWrite === "failed")
    ? ("failed" as const)
    : attempted.some((result) => result.evidenceWrite === "not_eligible")
      ? ("not_eligible" as const)
      : attempted.some((result) => result.evidenceWrite === "written")
        ? ("written" as const)
        : ("not_attempted" as const);
  return Object.freeze({
    write,
    ...(write === "not_eligible"
      ? {
          writeReason: attempted.find(
            (result) => result.evidenceWriteReason !== undefined,
          )?.evidenceWriteReason,
        }
      : {}),
  });
}
