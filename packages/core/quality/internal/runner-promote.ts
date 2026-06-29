/**
 * Promotion implementation for the Quality runner facade.
 *
 * Promotion reads a persisted experiment and writes the committed baseline
 * record without exposing baseline path helpers or ULID generation to callers.
 *
 * @internal
 * @module
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ExperimentCell } from '../experiment'
import { buildBaselineReference, gitUserName, writeBaselineRecord, type BaselineRecord } from './baseline'
import { experimentRecordPath } from './persist'
import { ulid } from './ulid'
import type {
  QualityCollectedEvaluation,
  QualityEventSink,
  QualityPromoteInput,
  QualityPromoteResult,
  QualityRunnerEnv,
} from './runner-types'

/** The slice of the persisted experiment record promotion needs. */
interface PersistedExperiment {
  readonly evaluationId: string
  readonly configFingerprint: string
  readonly filteredRun: boolean
  readonly variants: readonly { readonly name: string }[]
  readonly cases: readonly ExperimentCell[]
}

/** Promote a persisted experiment into a committed baseline. */
export async function promoteQualityExperiment(
  env: QualityRunnerEnv,
  input: QualityPromoteInput,
): Promise<QualityPromoteResult> {
  const emit = env.events
  const dir = env.dir ?? join(env.rootDir ?? process.cwd(), '.crux/quality')
  const rootDir = env.rootDir ?? process.cwd()
  const fail = (message: string): QualityPromoteResult => {
    emit?.({ type: 'error', scope: 'promote', message })
    return { exitCode: 2 }
  }

  const recordPath = experimentRecordPath(dir, input.experimentId)
  let record: PersistedExperiment
  try {
    record = JSON.parse(await readFile(recordPath, 'utf8')) as PersistedExperiment
  } catch {
    return fail(`experiment '${input.experimentId}' not found under ${dir} — run \`crux quality run\` first.`)
  }

  if (record.filteredRun) {
    return fail(
      'filtered runs cannot be promoted — paired baseline statistics need the full case population (spec 03 §4).',
    )
  }

  const evaluation = input.evaluations.find((entry) => entry.id === record.evaluationId)
  if (evaluation === undefined) {
    return fail(
      `evaluation '${record.evaluationId}' is no longer discovered — promotion needs the evaluation present in the project.`,
    )
  }

  const identity = resolvePromotionIdentity(evaluation, record.evaluationId, input.pinId)
  if ('error' in identity) return fail(identity.error)

  const variant = resolvePromotionVariant(record, evaluation, input.experimentId, input.variant)
  if ('error' in variant) return fail(variant.error)

  const baselineRecord: BaselineRecord = {
    schemaVersion: 1,
    baselineId: ulid(),
    evaluationId: identity.evaluationId,
    experimentId: input.experimentId,
    ...(variant.variantsDeclared ? { variantName: variant.variantName } : {}),
    promotedAt: new Date().toISOString(),
    ...(gitUserName(rootDir) !== undefined ? { promotedBy: gitUserName(rootDir) } : {}),
    configFingerprint: record.configFingerprint,
    reference: buildBaselineReference(record.cases, variant.variantName),
  }
  const path = await writeBaselineRecord(dir, baselineRecord)

  const baseline = {
    evaluationId: identity.evaluationId,
    experimentId: input.experimentId,
    baselineId: baselineRecord.baselineId,
    path,
    ...(variant.variantsDeclared ? { variantName: variant.variantName } : {}),
    ...(identity.pinHint !== undefined ? { pinHint: identity.pinHint } : {}),
  }
  emitPromoteDone(emit, baseline)
  return { exitCode: 0, baseline }
}

function resolvePromotionIdentity(
  evaluation: QualityCollectedEvaluation,
  recordEvaluationId: string,
  pinId: string | undefined,
): { evaluationId: string; pinHint?: string } | { error: string } {
  if (!evaluation.explicitId) {
    if (pinId === undefined) {
      return {
        error:
          `evaluation '${recordEvaluationId}' has a path-derived id — baselines need a stable identity. ` +
          `Re-run with --pin-id <id>, then pin it in source: evaluate('<id>', { … }) in ${evaluation.file}.`,
      }
    }
    return {
      evaluationId: pinId,
      pinHint: `evaluate('${pinId}', { … }) — add the id in ${evaluation.file}`,
    }
  }

  if (pinId !== undefined && pinId !== recordEvaluationId) {
    return {
      error: `--pin-id '${pinId}' conflicts with the explicit id '${recordEvaluationId}' already in source.`,
    }
  }
  return { evaluationId: recordEvaluationId }
}

function resolvePromotionVariant(
  record: PersistedExperiment,
  evaluation: QualityCollectedEvaluation,
  experimentId: string,
  selected: string | undefined,
): { variantName: string; variantsDeclared: boolean } | { error: string } {
  const variantNames = record.variants.map((variant) => variant.name)
  const variantsDeclared = !(variantNames.length === 1 && variantNames[0] === 'default')
  let variantName = selected

  if (variantName === undefined) {
    if (variantNames.length === 1) variantName = variantNames[0]!
    else if (evaluation.manifest.baseline !== undefined) {
      variantName = evaluation.manifest.baseline
      if (!variantNames.includes(variantName)) {
        return {
          error: `unknown variant '${variantName}' — this experiment ran: ${variantNames.join(', ')}.`,
        }
      }
    } else {
      return {
        error:
          `experiment '${experimentId}' ran ${variantNames.length} variants — pass --variant <name> ` +
          `(one of: ${variantNames.join(', ')}).`,
      }
    }
  } else if (!variantNames.includes(variantName)) {
    return {
      error: `unknown variant '${variantName}' — this experiment ran: ${variantNames.join(', ')}.`,
    }
  }

  return { variantName, variantsDeclared }
}

function emitPromoteDone(
  emit: QualityEventSink | undefined,
  baseline: {
    readonly evaluationId: string
    readonly experimentId: string
    readonly baselineId: string
    readonly path: string
    readonly variantName?: string
    readonly pinHint?: string
  },
): void {
  emit?.({
    type: 'promote:done',
    evaluationId: baseline.evaluationId,
    experimentId: baseline.experimentId,
    baselineId: baseline.baselineId,
    path: baseline.path,
    ...(baseline.variantName !== undefined ? { variantName: baseline.variantName } : {}),
    ...(baseline.pinHint !== undefined ? { pinHint: baseline.pinHint } : {}),
  })
}
