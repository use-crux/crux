import type { ProjectCatalogSnapshot } from '@crux/core/catalog'
import type { CatalogPatch } from '../patches'
import { semanticCatalogFactsCached } from '../semantic-cache'
import { semanticSupportSources } from '../semantic-support'
import type { DependencyClosureReindexDecision, SourceFileReindexDecision } from './types'

type SemanticExecutableDecision = SourceFileReindexDecision | DependencyClosureReindexDecision

interface SemanticPartialPatchInput {
  readonly decision: SemanticExecutableDecision
  readonly previousCatalog: ProjectCatalogSnapshot
  readonly projectName?: string
  readonly configPath?: string
  readonly startedAt: string
}

/**
 * Executes semantic analyzers for the planner-approved affected file closure.
 */
export async function indexProjectSemanticPartial(input: SemanticPartialPatchInput): Promise<{
  readonly patch: CatalogPatch
  readonly analyzedFiles: readonly string[]
}> {
  const files = input.decision.affectedFiles.filter((file) => !input.decision.deletedFiles.includes(file))
  const facts = await semanticCatalogFactsCached(input.decision.root, files)
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
        sources: semanticSupportSources(input.previousCatalog, facts.sourceRefs),
        sourceGraph: input.previousCatalog.sourceGraph,
      },
    },
  }
}
