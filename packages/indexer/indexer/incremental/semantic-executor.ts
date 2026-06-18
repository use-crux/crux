import type { ProjectIndexSnapshot } from '@crux/core/project-index'
import { enforceIndexPatchBudget, type IndexPatch } from '../patches'
import { semanticIndexFactsCached } from '../semantic-cache'
import { degradedSemanticPatch, semanticFailureDiagnostic } from '../semantic/patch'
import { semanticBudgetWithDefaults, semanticPreflight } from '../semantic/preflight'
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
  const basePatch: IndexPatch = {
    schemaVersion: 1,
    phase: 'semantic',
    project: {
      root: input.decision.root,
      ...(input.projectName ? { name: input.projectName } : {}),
      ...(input.configPath ? { configFile: input.configPath } : {}),
    },
    startedAt: input.startedAt,
    status: 'ok',
    facts: {},
  }
  const semanticBudget = semanticBudgetWithDefaults(undefined)
  const preflight = await semanticPreflight(input.decision.root, files, semanticBudget)
  const budgetPatch = enforceIndexPatchBudget(basePatch, semanticBudget, preflight.usage)
  if (budgetPatch.status === 'degraded') {
    return { analyzedFiles: [], patch: { ...budgetPatch, finishedAt: new Date().toISOString() } }
  }

  let facts: Awaited<ReturnType<typeof semanticIndexFactsCached>>
  try {
    facts = await semanticIndexFactsCached(input.decision.root, files, {
      dependencyClosure: preflight.dependencyClosure,
    })
  } catch (error) {
    return {
      analyzedFiles: [],
      patch: degradedSemanticPatch(basePatch, [semanticFailureDiagnostic(error)]),
    }
  }

  return {
    analyzedFiles: files,
    patch: {
      ...basePatch,
      finishedAt: new Date().toISOString(),
      facts: {
        ...facts,
        sources: semanticSupportSources(input.previousIndex, facts.sourceRefs),
        sourceGraph: input.previousIndex.sourceGraph,
      },
    },
  }
}
