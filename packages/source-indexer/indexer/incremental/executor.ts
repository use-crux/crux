import { catalogPatchFromSnapshot } from '../patches'
import { indexProjectSemantic } from '../index'
import { runSourceOnlyProjectIndexingSession } from '../session'
import { incrementalExecutionReport } from './execution-report'
import type { IncrementalIndexExecutionResult, IndexProjectIncrementalOptions } from './execution-types'
import { catalogInvalidationFromDecision } from './invalidation'
import { planIndexFiles } from './plan'
import { indexProjectSemanticPartial } from './semantic-executor'
import { indexProjectAstPartial } from './static-executor'

/**
 * Executes incremental catalog indexing when the planner can prove a safe affected closure.
 *
 * Full reindex remains the correctness fallback for unsafe, incomplete, or unsupported plans.
 */
export async function indexProjectIncremental(
  options: IndexProjectIncrementalOptions,
): Promise<IncrementalIndexExecutionResult> {
  const startedAt = new Date().toISOString()
  const decision = planIndexFiles({
    root: options.root,
    files: options.files,
    deletedFiles: options.deletedFiles,
    previousCatalog: options.previousCatalog,
    maxAffectedFiles: options.maxAffectedFiles,
  })
  const invalidation = catalogInvalidationFromDecision(decision)

  if (decision.kind === 'full-reindex-required' || decision.kind === 'semantic-closure-reindex') {
    const snapshot = await runSourceOnlyProjectIndexingSession({
      root: options.root,
      configPath: options.configPath,
      projectName: options.projectName,
    })
    const patches = [
      catalogPatchFromSnapshot(snapshot, 'ast', 'ok'),
      ...(options.mode === 'ast-and-semantic'
        ? [
            await indexProjectSemantic({
              root: options.root,
              configPath: options.configPath,
              projectName: options.projectName,
              previousCatalog: snapshot,
            }),
          ]
        : []),
    ]
    return {
      decision,
      patches,
      report: incrementalExecutionReport({
        decision,
        invalidation,
        fallbackReason: decision.kind === 'full-reindex-required' ? decision.reason : 'semantic-closure-unsupported',
      }),
    }
  }

  const ast = await indexProjectAstPartial({
    decision,
    previousCatalog: options.previousCatalog,
    projectName: options.projectName,
    configPath: options.configPath,
    startedAt,
  })
  const semantic =
    options.mode === 'ast-and-semantic'
      ? await indexProjectSemanticPartial({
          decision,
          previousCatalog: options.previousCatalog,
          projectName: options.projectName,
          configPath: options.configPath,
          startedAt,
        })
      : undefined
  return {
    decision,
    patches: semantic ? [ast.patch, semantic.patch] : [ast.patch],
    report: incrementalExecutionReport({
      decision,
      invalidation,
      staticParsedFiles: ast.parsedFiles,
      semanticAnalyzedFiles: semantic?.analyzedFiles,
    }),
  }
}
