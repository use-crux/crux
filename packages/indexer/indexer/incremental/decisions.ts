import type {
  AbsoluteSourceFilePath,
  DependencyClosureReindexDecision,
  FullReindexReason,
  FullReindexRequiredDecision,
  GraphConfidence,
  IncrementalDecisionExplanation,
  SourceFileReindexDecision,
} from './types'

/**
 * Creates the standard conservative full reindex decision.
 */
export function fullReindexDecision(input: {
  readonly reason: FullReindexReason
  readonly root: string
  readonly files: readonly AbsoluteSourceFilePath[]
  readonly deletedFiles: readonly AbsoluteSourceFilePath[]
  readonly graphConfidence: Exclude<GraphConfidence, 'complete-enough-for-source-closure'>
  readonly previousIndexDefinitionCount: number
  readonly summary: string
  readonly graphAvailable?: boolean
}): FullReindexRequiredDecision {
  return {
    kind: 'full-reindex-required',
    reason: input.reason,
    root: input.root,
    files: input.files,
    changedFiles: input.files,
    deletedFiles: input.deletedFiles,
    graphConfidence: input.graphConfidence,
    previousIndexDefinitionCount: input.previousIndexDefinitionCount,
    explanation: explanation({
      summary: input.summary,
      graphAvailable: input.graphAvailable ?? false,
      fallbackUsed: true,
      traversedFiles: [],
    }),
  }
}

/**
 * Creates a source-file-only planning decision.
 */
export function sourceFileDecision(input: {
  readonly root: string
  readonly changedFiles: readonly AbsoluteSourceFilePath[]
  readonly deletedFiles: readonly AbsoluteSourceFilePath[]
  readonly affectedFiles: readonly AbsoluteSourceFilePath[]
  readonly affectedDefinitionIds: readonly string[]
}): SourceFileReindexDecision {
  return {
    kind: 'source-file-reindex',
    root: input.root,
    changedFiles: input.changedFiles,
    deletedFiles: input.deletedFiles,
    affectedFiles: input.affectedFiles,
    affectedDefinitionIds: input.affectedDefinitionIds,
    graphConfidence: 'complete-enough-for-source-closure',
    explanation: explanation({
      summary: 'Changed files are known source leaves in the previous index graph.',
      graphAvailable: true,
      fallbackUsed: false,
      traversedFiles: input.affectedFiles,
    }),
  }
}

/**
 * Creates a reverse dependency closure planning decision.
 */
export function dependencyClosureDecision(input: {
  readonly root: string
  readonly changedFiles: readonly AbsoluteSourceFilePath[]
  readonly deletedFiles: readonly AbsoluteSourceFilePath[]
  readonly affectedFiles: readonly AbsoluteSourceFilePath[]
  readonly affectedDefinitionIds: readonly string[]
}): DependencyClosureReindexDecision {
  return {
    kind: 'dependency-closure-reindex',
    root: input.root,
    changedFiles: input.changedFiles,
    deletedFiles: input.deletedFiles,
    affectedFiles: input.affectedFiles,
    affectedDefinitionIds: input.affectedDefinitionIds,
    graphConfidence: 'complete-enough-for-source-closure',
    explanation: explanation({
      summary: 'Changed files affect known dependents through the previous index source graph.',
      graphAvailable: true,
      fallbackUsed: false,
      traversedFiles: input.affectedFiles,
    }),
  }
}

function explanation(input: IncrementalDecisionExplanation): IncrementalDecisionExplanation {
  return input
}
