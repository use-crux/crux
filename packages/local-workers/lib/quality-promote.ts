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

export async function promoteExperiment(options: PromoteOptions): Promise<PromoteResult> {
  const runner = options.core.createQualityRunner({
    dir: options.dir,
    rootDir: options.rootDir,
    events: options.emit,
  })
  const result = await runner.promote({
    evaluations: options.collected,
    experimentId: options.experimentId,
    ...(options.variant !== undefined ? { variant: options.variant } : {}),
    ...(options.pinId !== undefined ? { pinId: options.pinId } : {}),
  })
  return { exitCode: result.exitCode }
}
