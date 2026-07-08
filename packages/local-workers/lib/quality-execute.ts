/**
 * Quality execute phase — runs collected evaluations through the core engine
 * and emits the single NDJSON event stream (spec 03 §2). The Go CLI renders
 * the stream; devtools consumes it live.
 *
 * Exit codes (spec 03 §1, binding): `0` all blocking gates passed, `1` a
 * gate/expect failed or a cell errored, `2` definition/discovery error.
 *
 * @module
 */

import type { ExperimentDiff, QualityRunnerEnv, QualityRunnerEvent } from '@use-crux/core/quality/internal/runner'
import type { QualitySourceFrameResolver, ReplayMode } from '@use-crux/core/quality'
import type { CollectedEvaluation, CollectError } from './quality-collect'
import type { RunnerCore } from './quality-core-bridge'
import type { QualityInitTarget } from './quality-init'

// ─────────────────────────────────────────────────────────────────
// Event stream (spec 03 §2 — one stream, no per-kind pipelines)
// ─────────────────────────────────────────────────────────────────

/** The worker ⇄ CLI event stream. Serialized as NDJSON on stdout. */
export type QualityRunEvent =
  | QualityRunnerEvent
  | { type: 'diff:done'; runId?: string; diff: ExperimentDiff }
  | { type: 'init:targets'; runId?: string; targets: readonly QualityInitTarget[] }

// ─────────────────────────────────────────────────────────────────
// Options
// ─────────────────────────────────────────────────────────────────

export interface ExecuteOptions {
  /** The project's `@use-crux/core` runner contract (quality-core-bridge). */
  core: RunnerCore
  collected: readonly CollectedEvaluation[]
  /** Evaluation ids to run (exit 2 on unknown, with nearest-match hint). */
  ids?: readonly string[]
  /** Case id/name filters (glob `*`), forwarded to the engine. */
  cases?: readonly string[]
  /** Variant subset; excluding the baseline variant demotes gates (spec 03 §4). */
  variants?: readonly string[]
  /** Replay mode override (non-live modes land in phase 5). */
  replayMode?: ReplayMode
  /** Re-score cached outputs without executing tasks (watch cache). */
  reuseOutputs?: boolean
  /** Trials override for this run. */
  trials?: number
  /** Grouping label stored on the records. */
  experimentLabel?: string
  /** Cap on parallel cells per evaluation. */
  concurrency?: number
  engine: {
    qualityId?: string
    dir?: string
    persist?: boolean
    redact?: readonly string[]
    rootDir?: string
    /** Project-config run defaults (`quality.defaults`), weakest in the resolution order. */
    defaults?: {
      trials?: number
      concurrency?: number
      timeoutMs?: number
      replay?: ReplayMode
    }
    /** Output-cache root (watch/--rescore, spec 03 §5). */
    cacheDir?: string
    /** Authored-source resolver supplied by the local runner. */
    sourceFrameResolver?: QualitySourceFrameResolver
    /** Lazy ambient-provider resolution — called at most once per run. */
    resolveSetup?: QualityRunnerEnv['setup']
  }
  emit: (event: QualityRunEvent) => void
}

export interface ExecuteResult {
  exitCode: 0 | 1 | 2
  experimentIds: string[]
}

// ─────────────────────────────────────────────────────────────────
// Execution
// ─────────────────────────────────────────────────────────────────

/**
 * Execute the selected evaluations sequentially (cells inside an evaluation
 * run concurrently in the engine), emitting the live event stream. Never
 * throws for run outcomes — everything lands in the exit code.
 */
export async function executeEvaluations(options: ExecuteOptions): Promise<ExecuteResult> {
  const runner = options.core.createQualityRunner({
    ...(options.engine.qualityId !== undefined ? { qualityId: options.engine.qualityId } : {}),
    ...(options.engine.dir !== undefined ? { dir: options.engine.dir } : {}),
    ...(options.engine.persist !== undefined ? { persist: options.engine.persist } : {}),
    ...(options.engine.redact !== undefined ? { redact: options.engine.redact } : {}),
    ...(options.engine.rootDir !== undefined ? { rootDir: options.engine.rootDir } : {}),
    ...(options.engine.defaults !== undefined ? { defaults: options.engine.defaults } : {}),
    ...(options.engine.cacheDir !== undefined ? { cacheDir: options.engine.cacheDir } : {}),
    ...(options.engine.resolveSetup !== undefined ? { setup: options.engine.resolveSetup } : {}),
    ...(options.engine.sourceFrameResolver !== undefined
      ? { sourceFrames: { resolver: options.engine.sourceFrameResolver } }
      : {}),
    events: options.emit,
  })
  const result = await runner.run({
    evaluations: options.collected,
    ...(options.ids !== undefined ? { ids: options.ids } : {}),
    ...(options.cases !== undefined ? { cases: options.cases } : {}),
    ...(options.variants !== undefined ? { variants: options.variants } : {}),
    ...(options.replayMode !== undefined ? { replayMode: options.replayMode } : {}),
    ...(options.reuseOutputs !== undefined ? { reuseOutputs: options.reuseOutputs } : {}),
    ...(options.trials !== undefined ? { trials: options.trials } : {}),
    ...(options.experimentLabel !== undefined ? { experimentLabel: options.experimentLabel } : {}),
    ...(options.concurrency !== undefined ? { concurrency: options.concurrency } : {}),
  })
  return {
    exitCode: result.exitCode,
    experimentIds: [...result.experimentIds],
  }
}
