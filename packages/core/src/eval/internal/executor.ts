/** Portable execution facade for an immutable admitted Eval plan. @internal */

import { aggregateVariant } from "./aggregate";
import {
  executePlannedCell,
  type EvalCellExecutionResult,
} from "./execute-cell";
import { evaluateBlockingGates } from "./gates";
import type { EvalExecutionPorts } from "./ports";
import type { EvalPlan, EvalRun } from "./types";

export async function executeEvalPlan(
  plan: EvalPlan,
  ports: EvalExecutionPorts,
): Promise<EvalRun> {
  const startedAt = ports.clock.now();
  const runId = ports.ids.next("run");
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
  const gates = evaluateBlockingGates(cells, blockingVariants);
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
    costControl: "not_required" as const,
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
    gates,
    cost: Object.freeze({
      ...(actualUsd !== undefined ? { actualUsd } : {}),
      reservedMaximumUsd: 0 as const,
      unknownActionCount: 0 as const,
      task: Object.freeze({
        ...(actualUsd !== undefined ? { actualUsd } : {}),
      }),
      judge: Object.freeze({ actualUsd: 0 as const }),
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
