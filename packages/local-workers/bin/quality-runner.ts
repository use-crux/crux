#!/usr/bin/env tsx

/**
 * Standalone Quality runner — the Node worker behind `crux quality`
 * (spec 03 §2: collect, then execute).
 *
 * Spawned by the Go CLI. Communicates via NDJSON on stdout; all other output
 * (logs, user-code noise) goes to stderr. One stream, no per-kind pipelines:
 *
 *   { type: 'collect:done', evaluations: [Manifest...], errors: [...] }
 *   { type: 'eval:start',   evaluationId, cells }
 *   { type: 'cell:start',   evaluationId, caseId, variantName, trial }
 *   { type: 'cell:done',    evaluationId, cell }                       // 02 spec shape
 *   { type: 'eval:done',    evaluationId, experimentId, aggregates, gates, recordPath? }
 *   { type: 'run:done',     experiments: [experimentId...], exitCode }
 *   { type: 'error',        scope: 'collect'|'execute', message, file? }
 *
 * Exit codes (binding, spec 03 §1): 0 gates passed · 1 gate/expect/cell
 * failure · 2 definition or discovery error (nothing executed).
 *
 * Flags: [ids...] --config <path> --collect-only --case <pattern>...
 *        --trials <n> --experiment <label> --max-concurrency <n> --no-persist
 *        --promote <experimentId> [--variant <name>] [--pin-id <id>]
 *
 * @module
 */

import { join } from 'node:path'
import type { ProjectModelDiagnostic } from '@use-crux/core/project-index'
import type { ReplayMode } from '@use-crux/core/quality'
import { SourceResolver } from '@use-crux/indexer/source-resolver'
import { loadEnv } from '../lib/env'
import { loadObservabilityCore, loadRunnerCore, QualityRunnerProtocolMismatchError } from '../lib/quality-core-bridge'
import { loadQualityProject, resolveQualityRunnerSettings, ensureQualityGitignore } from '../lib/quality-config'
import {
  collectEvaluationFiles,
  collectPromptTests,
  findDuplicateIdErrors,
  type CollectError,
} from '../lib/quality-collect'
import { executeEvaluations, type QualityRunEvent } from '../lib/quality-execute'
import { enableQualityRunnerObservability, flushQualityRunnerObservability } from '../lib/quality-observability'
import { promoteExperiment } from '../lib/quality-promote'
import { createQualityRunId } from '../lib/quality-run-id'
import { getArg, getRepeatedArg, hasFlag, positionalArgs } from '../lib/quality-runner-argv'

// Redirect console.log to stderr so stdout stays clean NDJSON.
console.log = (...args: unknown[]) => console.error(...args)

const runId = createQualityRunId()

function emit(event: QualityRunEvent): void {
  process.stdout.write(`${JSON.stringify({ ...event, runId })}\n`)
}

async function main(): Promise<number> {
  const args = process.argv.slice(2)
  const configPath = getArg(args, '--config')
  const collectOnly = hasFlag(args, '--collect-only')
  const cases = getRepeatedArg(args, '--case')
  const variants = getRepeatedArg(args, '--variant')
  const replayArg = getArg(args, '--replay')
  const rescore = hasFlag(args, '--rescore')
  const trialsArg = getArg(args, '--trials')
  const experimentLabel = getArg(args, '--experiment')
  const maxConcurrency = getArg(args, '--max-concurrency')
  const persist = !hasFlag(args, '--no-persist')
  const promoteId = getArg(args, '--promote')
  const pinId = getArg(args, '--pin-id')
  const diffA = getArg(args, '--diff-a')
  const diffB = getArg(args, '--diff-b')
  const ids = positionalArgs(args)

  const REPLAY_MODES: readonly ReplayMode[] = ['live', 'record-new', 'replay-strict', 'refresh']
  if (replayArg !== undefined && !REPLAY_MODES.includes(replayArg as ReplayMode)) {
    emit({
      type: 'error',
      scope: 'execute',
      message: `Unknown --replay mode '${replayArg}'. Use: ${REPLAY_MODES.join(' · ')}.`,
    })
    emit({ type: 'run:done', experiments: [], exitCode: 2 })
    return 2
  }
  const replayMode = replayArg as ReplayMode | undefined

  loadEnv()

  // ── Collect ────────────────────────────────────────────────────
  let project
  let core
  let observabilityCore
  let restoreObservability: (() => void) | undefined
  try {
    project = await loadQualityProject(configPath)
    // The project's own @use-crux/core instance — never the bundled one (see
    // quality-core-bridge for the dual-package-hazard rationale).
    core = await loadRunnerCore(project.configDir)
    observabilityCore = await loadObservabilityCore(project.configDir)
    restoreObservability = enableQualityRunnerObservability(observabilityCore, process.env.CRUX_DEVTOOLS_URL)
  } catch (error) {
    emit({
      type: 'error',
      scope: 'collect',
      message: describeError(error),
      ...(qualityRunnerErrorCode(error) ? { code: qualityRunnerErrorCode(error) } : {}),
    })
    emit({
      type: 'run:done',
      experiments: [],
      exitCode: 2,
      ok: false,
      error: { code: qualityRunnerErrorCode(error) ?? 'runner-crash', message: describeError(error) },
    })
    return 2
  }

  if (diffA !== undefined || diffB !== undefined) {
    try {
      if (diffA === undefined || diffB === undefined) {
        emit({
          type: 'error',
          scope: 'execute',
          message: 'quality diff requires both --diff-a and --diff-b.',
        })
        emit({ type: 'run:done', experiments: [], exitCode: 2 })
        return 2
      }
      const runner = core.createQualityRunner()
      const diff = await runner.compare({ a: diffA, b: diffB })
      emit({ type: 'diff:done', diff })
      emit({ type: 'run:done', experiments: [], exitCode: 0 })
      return 0
    } catch (error) {
      emit({
        type: 'error',
        scope: 'execute',
        message: describeError(error),
      })
      emit({
        type: 'run:done',
        experiments: [],
        exitCode: 2,
        ok: false,
        error: { code: 'runner-crash', message: describeError(error) },
      })
      return 2
    } finally {
      await flushQualityRunnerObservability(observabilityCore)
      restoreObservability?.()
    }
  }

  const settings = resolveQualityRunnerSettings(project.quality, project.configDir)
  const fromFiles = await collectEvaluationFiles({
    rootDir: project.configDir,
    include: settings.include,
    exclude: settings.exclude,
    core,
    validateDuplicateIds: false,
  })
  const fromPrompts = await collectPromptTests(project.prompts, core, { validateDuplicateIds: false })
  const promptDiagnosticErrors = project.promptDiagnostics.map(collectErrorFromProjectModelDiagnostic)
  const collected = [...fromFiles.evaluations, ...fromPrompts.evaluations]
  const errors = [
    ...fromFiles.errors,
    ...fromPrompts.errors,
    ...promptDiagnosticErrors,
    ...findDuplicateIdErrors(collected),
  ]

  emit({
    type: 'collect:done',
    evaluations: collected.map((entry) => entry.manifest),
    errors,
  })

  if (errors.length > 0) {
    for (const error of errors) {
      emit({
        type: 'error',
        scope: 'collect',
        message: error.message,
        ...(error.code ? { code: error.code } : {}),
        ...(error.file ? { file: error.file } : {}),
        ...(error.line !== undefined ? { line: error.line } : {}),
      })
    }
    emit({ type: 'run:done', experiments: [], exitCode: 2 })
    return 2
  }
  if (collectOnly) {
    emit({ type: 'run:done', experiments: [], exitCode: 0 })
    return 0
  }

  // ── Promote (spec 03 §1: crux quality promote <experimentId>) ────
  if (promoteId !== undefined) {
    const result = await promoteExperiment({
      core,
      collected,
      dir: settings.dir,
      rootDir: project.configDir,
      experimentId: promoteId,
      // `--variant` is shared with run; promote takes at most one.
      ...(variants.length > 0 ? { variant: variants[0] } : {}),
      ...(pinId !== undefined ? { pinId } : {}),
      emit,
    })
    emit({ type: 'run:done', experiments: [], exitCode: result.exitCode })
    return result.exitCode
  }

  // ── Execute ────────────────────────────────────────────────────
  if (persist) await ensureQualityGitignore(settings.dir)
  const sourceResolver = new SourceResolver({ projectRoot: project.configDir })

  try {
    const result = await executeEvaluations({
      core,
      collected,
      ...(ids.length > 0 ? { ids } : {}),
      ...(cases.length > 0 ? { cases } : {}),
      ...(variants.length > 0 ? { variants } : {}),
      ...(replayMode !== undefined ? { replayMode } : {}),
      ...(rescore ? { reuseOutputs: true } : {}),
      ...(trialsArg !== undefined ? { trials: Number(trialsArg) } : {}),
      ...(experimentLabel !== undefined ? { experimentLabel } : {}),
      ...(maxConcurrency !== undefined ? { concurrency: Number(maxConcurrency) } : {}),
      engine: {
        ...(settings.qualityId !== undefined ? { qualityId: settings.qualityId } : {}),
        dir: settings.dir,
        persist,
        redact: settings.redact,
        rootDir: project.configDir,
        defaults: settings.defaults,
        cacheDir: join(settings.dir, 'cache'),
        sourceFrameResolver: {
          resolveSourceFrame: (request) =>
            sourceResolver.resolveSourceFrame(request.file, request.line, request.column, {
              sourceRef: request.sourceRef,
              frameRadius: request.frameRadius,
              role: request.role,
              capturedAt: request.capturedAt,
            }),
        },
      },
      emit,
    })
    return result.exitCode
  } finally {
    await flushQualityRunnerObservability(observabilityCore)
    restoreObservability?.()
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function collectErrorFromProjectModelDiagnostic(diagnostic: ProjectModelDiagnostic): CollectError {
  return {
    message: diagnostic.suggestedFix ? `${diagnostic.message} ${diagnostic.suggestedFix}` : diagnostic.message,
    code: diagnostic.code,
    ...(diagnostic.source?.file ? { file: diagnostic.source.file } : {}),
    ...(diagnostic.source?.line !== undefined ? { line: diagnostic.source.line } : {}),
  }
}

main()
  .then((exitCode) => process.exit(exitCode))
  .catch((error: unknown) => {
    emit({
      type: 'error',
      scope: 'execute',
      message: describeError(error),
      ...(qualityRunnerErrorCode(error) ? { code: qualityRunnerErrorCode(error) } : {}),
    })
    emit({
      type: 'run:done',
      experiments: [],
      exitCode: 2,
      ok: false,
      error: { code: qualityRunnerErrorCode(error) ?? 'runner-crash', message: describeError(error) },
    })
    process.exit(2)
  })

function qualityRunnerErrorCode(error: unknown): 'protocol-mismatch' | undefined {
  return error instanceof QualityRunnerProtocolMismatchError ? error.code : undefined
}
