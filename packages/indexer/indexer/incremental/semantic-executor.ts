import type { ProjectIndexSnapshot } from '@crux/core/project-index'
import type { IndexPatch } from '../patches'
import { semanticIndexFactsCached } from '../semantic-cache'
import { semanticSupportSources } from '../semantic-support'
import type { DependencyClosureReindexDecision, SourceFileReindexDecision } from './types'

type SemanticExecutableDecision = SourceFileReindexDecision | DependencyClosureReindexDecision

interface SemanticPartialPatchInput {
  readonly decision: SemanticExecutableDecision
  readonly previousIndex: ProjectIndexSnapshot
  readonly projectName?: string
  readonly configPath?: string
  readonly startedAt: string
}

/**
 * Executes semantic analyzers for the planner-approved affected file closure.
 */
export async function indexProjectSemanticPartial(input: SemanticPartialPatchInput): Promise<{
  readonly patch: IndexPatch
  readonly analyzedFiles: readonly string[]
}> {
  const files = input.decision.affectedFiles.filter((file) => !input.decision.deletedFiles.includes(file))
  const facts = await semanticIndexFactsCached(input.decision.root, files)
  return {
    analyzedFiles: files,
    patch: {
      schemaVersion: 1,
      phase: 'semantic',
      project: {
        root: input.decision.root,
        ...(input.projectName ? { name: input.projectName } : {}),
        ...(input.configPath ? { configFile: input.configPath } : {}),
      },
      startedAt: input.startedAt,
      finishedAt: new Date().toISOString(),
      status: 'ok',
      facts: {
        ...facts,
        sources: semanticSupportSources(input.previousIndex, facts.sourceRefs),
        sourceGraph: input.previousIndex.sourceGraph,
      },
    },
  }
}
