import type { ProjectIndexSnapshot } from '@use-crux/core/project-index'
import type { IndexPatch } from '../patches'
import { createSemanticIndexService } from '../semantic/service'
import type { SemanticIndexInstrumentation } from '../semantic/instrumentation'
import type { SemanticBackendSelection } from '../semantic/service'
import type { DependencyClosureReindexDecision, SourceFileReindexDecision } from './types'

type SemanticExecutableDecision = SourceFileReindexDecision | DependencyClosureReindexDecision

interface SemanticPartialPatchInput {
  readonly decision: SemanticExecutableDecision
  readonly previousIndex: ProjectIndexSnapshot
  readonly projectName?: string
  readonly configPath?: string
  readonly startedAt: string
  readonly semanticBackend?: SemanticBackendSelection
  readonly semanticInstrumentation?: SemanticIndexInstrumentation
}

/**
 * Executes semantic analyzers for the planner-approved affected file closure.
 */
export async function indexProjectSemanticPartial(input: SemanticPartialPatchInput): Promise<{
  readonly patch: IndexPatch
  readonly analyzedFiles: readonly string[]
}> {
  const files = input.decision.affectedFiles.filter((file) => !input.decision.deletedFiles.includes(file))
  const patch = await createSemanticIndexService().indexFiles({
    root: input.decision.root,
    files,
    previousIndex: input.previousIndex,
    projectName: input.projectName,
    configPath: input.configPath,
    startedAt: input.startedAt,
    semanticBackend: input.semanticBackend,
    semanticInstrumentation: input.semanticInstrumentation,
  })
  return { analyzedFiles: patch.status === 'degraded' ? [] : files, patch }
}
