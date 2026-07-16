/** Node coordination ports for planning and executing one discovered Eval. */

import { randomUUID } from 'node:crypto'
import type { EvalRunnerCore, EvalNodeCore } from './eval-core-bridge'
import type { HydratedEval } from './eval-cases'
import type {
  EvalPlan,
  EvalRun,
  EvalPlanningPorts,
  EvalTaskHostRequest,
} from '@use-crux/core/eval/internal/runner'

export interface EvalRunOptions {
  readonly variant?: string
  readonly fresh?: boolean
  readonly offline?: boolean
  readonly plan?: boolean
  readonly maxCostUsd?: number
  readonly confirmUnknownCost?: boolean
  readonly filtered?: boolean
}

export interface CoordinatedEvalPlan {
  readonly plan: EvalPlan
  readonly execute: () => Promise<EvalRun>
}

/** Plan exact work and bind an execution closure without performing it. */
export async function coordinateEval(
  entry: HydratedEval,
  options: EvalRunOptions,
  core: EvalRunnerCore,
  node: EvalNodeCore,
  projectRoot: string,
): Promise<CoordinatedEvalPlan> {
  const evidenceStore = node.createEvalEvidenceFileStore({ projectRoot })
  const runStore = node.createEvalRunFileStore({ projectRoot })
  const planningPorts: EvalPlanningPorts = {
    evidenceStore,
    taskIdentity: {
      describe: async (request) => ({
        reusable: true,
        managedTaskFingerprint:
          core.fingerprintEvalTaskSourceForInternalUse(request.task),
        hostContractFingerprint: 'crux.eval-local-task-host',
      }),
    },
    externalScorerHostContractFingerprint: 'crux.eval-local-scorer-host',
    costEstimator: {
      estimate: () => ({ kind: 'unknown', source: 'unknown' }),
    },
    ...(options.confirmUnknownCost
      ? { costConfirmation: { confirm: async () => true } }
      : {}),
  }
  const plan = await core.planEval(
    entry.eval,
    {
      sourceKey: entry.sourceKey,
      definitionFingerprint: entry.definitionFingerprint,
      ...(options.variant !== undefined ? { variant: options.variant } : {}),
      ...(options.fresh ? { fresh: true } : {}),
      ...(options.offline ? { offline: true } : {}),
      ...(options.maxCostUsd !== undefined ? { maxCostUsd: options.maxCostUsd } : {}),
      ...(options.filtered ? { filtered: true } : {}),
      interactive: options.plan === true || options.confirmUnknownCost === true,
      ...(options.plan ? { plan: true } : {}),
    },
    planningPorts,
  )
  const baseline = await node.createEvalBaselineFileStore({ projectRoot }).readForEval({
    sourceKey: entry.sourceKey,
    evalId: entry.id,
    definitionFingerprint: entry.definitionFingerprint,
  })
  return Object.freeze({
    plan,
    execute: () => core.executeEvalPlan(plan, {
      evidenceStore,
      runStore,
      ...(baseline !== undefined ? { baseline } : {}),
      clock: { now: () => Date.now() },
      ids: { next: () => `eval-${Date.now()}-${randomUUID()}` },
      taskHost: {
        execute: async (request) => executeTask(core, request),
      },
      externalScorerHost: {
        execute: async (request) => request.scorer({
          input: request.input,
          output: request.output,
          expected: request.expected,
        }),
      },
    }),
  })
}

async function executeTask(
  core: EvalRunnerCore,
  request: EvalTaskHostRequest,
) {
  const startedAt = Date.now()
  const descriptor = core.getEvalTaskDescriptorForInternalUse(request.task)
  const result = await core.executeEvalTaskForInternalUse(
    request.task as never,
    request.input as never,
    request.call as never,
    request.overrides,
  )
  const costUsd = result.response.cost
  return Object.freeze({
    ...result,
    capturedSignals: descriptor.capabilities,
    runIds: Object.freeze([]),
    metrics: Object.freeze({
      durationMs: Math.max(0, Date.now() - startedAt),
      ...(typeof costUsd === 'number' && Number.isFinite(costUsd) && costUsd >= 0
        ? { costUsd }
        : {}),
    }),
  })
}
