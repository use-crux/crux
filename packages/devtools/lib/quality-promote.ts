/**
 * Quality promote phase — the worker behind `crux quality promote
 * <experimentId>` (spec 03 §1, spec 02 §3). Reads the persisted experiment
 * record, validates the promotion rules, and writes the committed
 * BaselineRecord through the project's own `@use-crux/core` instance.
 *
 * Promotion rules (binding):
 * - Filtered runs are refused — paired statistics need the full case
 *   population (spec 03 §4).
 * - The evaluation id must be explicit. A path-derived id needs `--pin-id`,
 *   and the result carries the one-line source change to make (the CLI never
 *   rewrites code; spec 01 §8).
 * - Multi-variant experiments promote their declared `baseline:` variant by
 *   default; `--variant` selects another.
 *
 * All failures are definition/usage errors: exit code 2, nothing written.
 *
 * @module
 */

import { readFile } from 'node:fs/promises'
import type { BaselineRecord, ExperimentCell } from '@use-crux/core/quality/internal/runner'
import type { RunnerCore } from './quality-core-bridge'
import type { CollectedEvaluation } from './quality-collect'
import type { QualityRunEvent } from './quality-execute'

export interface PromoteOptions {
  /** The project's own `@use-crux/core` runner contract (quality-core-bridge). */
  core: RunnerCore
  collected: readonly CollectedEvaluation[]
  /** Quality persistence root (`settings.dir`). */
  dir: string
  /** Project root (git provenance lookup). */
  rootDir: string
  experimentId: string
  /** Variant to promote (defaults to the declared baseline variant). */
  variant?: string
  /** Explicit id to pin for a path-derived evaluation. */
  pinId?: string
  emit: (event: QualityRunEvent) => void
}

export interface PromoteResult {
  exitCode: 0 | 2
}

/** The slice of the persisted experiment record (spec 02 §1) promotion reads. */
interface PersistedExperiment {
  evaluationId: string
  configFingerprint: string
  filteredRun: boolean
  variants: Array<{ name: string }>
  cases: ExperimentCell[]
}

export async function promoteExperiment(options: PromoteOptions): Promise<PromoteResult> {
  const { core, dir, emit } = options
  const fail = (message: string): PromoteResult => {
    emit({ type: 'error', scope: 'promote', message })
    return { exitCode: 2 }
  }

  // ── Load the persisted experiment record ─────────────────────────
  const recordPath = core.experimentRecordPath(dir, options.experimentId)
  let record: PersistedExperiment
  try {
    record = JSON.parse(await readFile(recordPath, 'utf8')) as PersistedExperiment
  } catch {
    return fail(`experiment '${options.experimentId}' not found under ${dir} — run \`crux quality run\` first.`)
  }

  if (record.filteredRun) {
    return fail(
      'filtered runs cannot be promoted — paired baseline statistics need the full case population (spec 03 §4).',
    )
  }

  // ── Identity: the evaluation must still exist, and its id must be pinned ──
  const evaluation = options.collected.find((entry) => entry.id === record.evaluationId)
  if (evaluation === undefined) {
    return fail(
      `evaluation '${record.evaluationId}' is no longer discovered — promotion needs the evaluation present in the project.`,
    )
  }
  let baselineEvaluationId = record.evaluationId
  let pinHint: string | undefined
  if (!evaluation.explicitId) {
    if (options.pinId === undefined) {
      return fail(
        `evaluation '${record.evaluationId}' has a path-derived id — baselines need a stable identity. ` +
          `Re-run with --pin-id <id>, then pin it in source: evaluate('<id>', { … }) in ${evaluation.file}.`,
      )
    }
    baselineEvaluationId = options.pinId
    pinHint = `evaluate('${options.pinId}', { … }) — add the id in ${evaluation.file}`
  } else if (options.pinId !== undefined && options.pinId !== record.evaluationId) {
    return fail(
      `--pin-id '${options.pinId}' conflicts with the explicit id '${record.evaluationId}' already in source.`,
    )
  }

  // ── Variant selection ────────────────────────────────────────────
  const variantNames = record.variants.map((variant) => variant.name)
  const variantsDeclared = !(variantNames.length === 1 && variantNames[0] === 'default')
  let variantName = options.variant
  if (variantName === undefined) {
    if (variantNames.length === 1) variantName = variantNames[0]!
    else if (evaluation.manifest.baseline !== undefined) variantName = evaluation.manifest.baseline
    else {
      return fail(
        `experiment '${options.experimentId}' ran ${variantNames.length} variants — pass --variant <name> (one of: ${variantNames.join(', ')}).`,
      )
    }
  } else if (!variantNames.includes(variantName)) {
    return fail(`unknown variant '${variantName}' — this experiment ran: ${variantNames.join(', ')}.`)
  }

  // ── Write the committed baseline ─────────────────────────────────
  const promotedBy = core.gitUserName(options.rootDir)
  const baselineRecord: BaselineRecord = {
    schemaVersion: 1,
    baselineId: core.ulid(),
    evaluationId: baselineEvaluationId,
    experimentId: options.experimentId,
    ...(variantsDeclared ? { variantName } : {}),
    promotedAt: new Date().toISOString(),
    ...(promotedBy !== undefined ? { promotedBy } : {}),
    configFingerprint: record.configFingerprint,
    reference: core.buildBaselineReference(record.cases, variantName),
  }
  const path = await core.writeBaselineRecord(dir, baselineRecord)

  emit({
    type: 'promote:done',
    evaluationId: baselineEvaluationId,
    experimentId: options.experimentId,
    baselineId: baselineRecord.baselineId,
    path,
    ...(variantsDeclared ? { variantName } : {}),
    ...(pinHint !== undefined ? { pinHint } : {}),
  })
  return { exitCode: 0 }
}
