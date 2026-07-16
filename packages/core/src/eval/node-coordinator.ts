/** Node planning/execution coordinator shared by scripts and Local. */

import { randomUUID } from "node:crypto";
import {
  createEvalBaselineFileStore,
  createEvalEvidenceFileStore,
  createEvalRunFileStore,
} from "./node-stores";
import type { HydratedEval } from "./node-cases";
import {
  executeEvalPlan,
  executeEvalTaskForInternalUse,
  fingerprintEvalTaskSourceForInternalUse,
  getEvalTaskDescriptorForInternalUse,
  planEval,
} from "./internal/runner";
import type {
  EvalPlan,
  EvalRun,
  EvalTaskHostRequest,
} from "./internal/types";
import type { EvalPlanningPorts } from "./internal/ports";

export interface NodeEvalCoordinatorOptions {
  readonly variant?: string;
  readonly fresh?: boolean;
  readonly offline?: boolean;
  readonly plan?: boolean;
  readonly maxCostUsd?: number;
  readonly filtered?: boolean;
  /** Internal CLI transport after its explicit interactive confirmation. */
  readonly confirmUnknownCost?: boolean;
}

export interface CoordinatedNodeEval {
  readonly plan: EvalPlan;
  readonly execute: () => Promise<EvalRun>;
}

/** Plan one hydrated Eval and bind its exact execution ports. */
export async function coordinateNodeEval(
  entry: HydratedEval,
  options: NodeEvalCoordinatorOptions,
  projectRoot: string,
): Promise<CoordinatedNodeEval> {
  const evidenceStore = createEvalEvidenceFileStore({ projectRoot });
  const runStore = createEvalRunFileStore({ projectRoot });
  const planningPorts: EvalPlanningPorts = {
    evidenceStore,
    taskIdentity: {
      describe: async (request) => ({
        reusable: true,
        managedTaskFingerprint: fingerprintEvalTaskSourceForInternalUse(
          request.task,
        ),
        hostContractFingerprint: "crux.eval-local-task-host",
      }),
    },
    externalScorerHostContractFingerprint: "crux.eval-local-scorer-host",
    costEstimator: {
      estimate: () => ({ kind: "unknown", source: "unknown" }),
    },
    ...(options.confirmUnknownCost
      ? { costConfirmation: { confirm: async () => true } }
      : {}),
  };
  const plan = await planEval(
    entry.eval,
    {
      sourceKey: entry.sourceKey,
      definitionFingerprint: entry.definitionFingerprint,
      ...(options.variant !== undefined ? { variant: options.variant } : {}),
      ...(options.fresh ? { fresh: true } : {}),
      ...(options.offline ? { offline: true } : {}),
      ...(options.maxCostUsd !== undefined
        ? { maxCostUsd: options.maxCostUsd }
        : {}),
      ...(options.filtered ? { filtered: true } : {}),
      interactive: options.plan === true || options.confirmUnknownCost === true,
      ...(options.plan ? { plan: true } : {}),
    },
    planningPorts,
  );
  return Object.freeze({
    plan,
    execute: async () => {
      const baseline = await createEvalBaselineFileStore({ projectRoot }).readForEval({
        sourceKey: entry.sourceKey,
        evalId: entry.id,
        definitionFingerprint: entry.definitionFingerprint,
      });
      return executeEvalPlan(plan, {
        evidenceStore,
        runStore,
        ...(baseline !== undefined ? { baseline } : {}),
        clock: { now: () => Date.now() },
        ids: { next: () => `eval-${Date.now()}-${randomUUID()}` },
        taskHost: { execute: executeTask },
        externalScorerHost: {
          execute: async (request) =>
            request.scorer({
              input: request.input,
              output: request.output,
              expected: request.expected,
            }),
        },
      });
    },
  });
}

async function executeTask(request: EvalTaskHostRequest) {
  const startedAt = Date.now();
  const descriptor = getEvalTaskDescriptorForInternalUse(request.task);
  const result = await executeEvalTaskForInternalUse(
    request.task as never,
    request.input as never,
    request.call as never,
    request.overrides,
  );
  const costUsd = result.response.cost;
  return Object.freeze({
    ...result,
    capturedSignals: descriptor.capabilities,
    runIds: Object.freeze([]),
    metrics: Object.freeze({
      durationMs: Math.max(0, Date.now() - startedAt),
      ...(typeof costUsd === "number" && Number.isFinite(costUsd) && costUsd >= 0
        ? { costUsd }
        : {}),
    }),
  });
}
