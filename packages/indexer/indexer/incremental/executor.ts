import { performance } from 'node:perf_hooks'
import {
  astIndexPatchFromCompilerResult,
  compileProjectIndex,
  projectIndexSnapshotFromCompilerResult,
} from '../compiler'
import { indexProjectSemantic } from '..'
import { incrementalExecutionReport } from './execution-report'
import type { IncrementalIndexExecutionResult, IndexProjectIncrementalOptions } from './execution-types'
import { indexInvalidationFromDecision } from './invalidation'
import { planIndexFiles } from './plan'
import { indexProjectSemanticPartial } from './semantic-executor'
import { indexProjectAstPartial } from './static-executor'
import type { IndexPatch } from '../patches'

/**
 * Executes incremental index indexing when the planner can prove a safe affected closure.
 *
 * Full reindex remains the correctness fallback for unsafe, incomplete, or unsupported plans.
 */
export async function indexProjectIncremental(
  options: IndexProjectIncrementalOptions,
): Promise<IncrementalIndexExecutionResult> {
  const startedAt = new Date().toISOString()
  const durationMsByPhase: Record<string, number> = {}
  const planningStarted = performance.now()
  const decision = planIndexFiles({
    root: options.root,
    files: options.files,
    deletedFiles: options.deletedFiles,
    previousIndex: options.previousIndex,
    maxAffectedFiles: options.maxAffectedFiles,
  })
  durationMsByPhase.planning = durationMsSince(planningStarted)
  const invalidation = indexInvalidationFromDecision(decision)

  if (decision.kind === 'full-reindex-required' || decision.kind === 'semantic-closure-reindex') {
    const astStarted = performance.now()
    const compilerResult = await compileProjectIndex({
      root: options.root,
      configPath: options.configPath,
      projectName: options.projectName,
      mode: options.resolutionMode ?? 'source-only',
    })
    durationMsByPhase.ast = durationMsSince(astStarted)
    const snapshot = projectIndexSnapshotFromCompilerResult(compilerResult)
    const patches = [astIndexPatchFromCompilerResult(compilerResult)]
    if (options.mode === 'ast-and-semantic') {
      const semanticStarted = performance.now()
      patches.push(
        await indexProjectSemantic({
          root: options.root,
          configPath: options.configPath,
          projectName: options.projectName,
          previousIndex: snapshot,
          semanticBackend: options.semanticBackend,
          semanticInstrumentation: options.semanticInstrumentation,
        }),
      )
      durationMsByPhase.semantic = durationMsSince(semanticStarted)
    }
    return {
      decision,
      patches,
      report: incrementalExecutionReport({
        decision,
        invalidation,
        fallbackReason: decision.kind === 'full-reindex-required' ? decision.reason : 'semantic-closure-unsupported',
        durationMsByPhase,
        patchCounts: patchCounts(patches),
        sourceProfileFileCount: sourceProfileFileCount(patches),
        semanticStatus: semanticStatusForPatches(options.mode, patches),
      }),
    }
  }

  const astStarted = performance.now()
  const ast = await indexProjectAstPartial({
    decision,
    previousIndex: options.previousIndex,
    projectName: options.projectName,
    configPath: options.configPath,
    startedAt,
  })
  durationMsByPhase.ast = durationMsSince(astStarted)
  let semantic: Awaited<ReturnType<typeof indexProjectSemanticPartial>> | undefined
  if (options.mode === 'ast-and-semantic') {
    const semanticStarted = performance.now()
    semantic = await indexProjectSemanticPartial({
      decision,
      previousIndex: options.previousIndex,
      projectName: options.projectName,
      configPath: options.configPath,
      startedAt,
      semanticBackend: options.semanticBackend,
      semanticInstrumentation: options.semanticInstrumentation,
    })
    durationMsByPhase.semantic = durationMsSince(semanticStarted)
  }
  return {
    decision,
    patches: semantic ? [ast.patch, semantic.patch] : [ast.patch],
    report: incrementalExecutionReport({
      decision,
      invalidation,
      staticParsedFiles: ast.parsedFiles,
      semanticAnalyzedFiles: semantic?.analyzedFiles,
      durationMsByPhase,
      patchCounts: patchCounts(semantic ? [ast.patch, semantic.patch] : [ast.patch]),
      sourceProfileFileCount: sourceProfileFileCount([ast.patch]),
      semanticStatus: semanticStatusForPatches(options.mode, semantic ? [ast.patch, semantic.patch] : [ast.patch]),
    }),
  }
}

function durationMsSince(startedAt: number): number {
  return Math.max(0.001, Number((performance.now() - startedAt).toFixed(3)))
}

function patchCounts(patches: readonly IndexPatch[]): { readonly ast: number; readonly semantic: number; readonly total: number } {
  return {
    ast: patches.filter((patch) => patch.phase === 'ast').length,
    semantic: patches.filter((patch) => patch.phase === 'semantic').length,
    total: patches.length,
  }
}

function sourceProfileFileCount(patches: readonly IndexPatch[]): number {
  return patches.reduce((count, patch) => count + (patch.semanticSourceProfile?.files.length ?? 0), 0)
}

function semanticStatusForPatches(
  mode: IndexProjectIncrementalOptions['mode'],
  patches: readonly IndexPatch[],
): 'not-requested' | 'ready' | 'degraded' {
  if (mode !== 'ast-and-semantic') return 'not-requested'
  const semantic = patches.find((patch) => patch.phase === 'semantic')
  if (!semantic) return 'not-requested'
  return semantic.status === 'degraded' ? 'degraded' : 'ready'
}
