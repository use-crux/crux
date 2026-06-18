import type { IndexPatchBudget } from '../patches'
import { semanticDependencyClosure } from './dependency-closure'

/** Default guardrails for semantic work before a TypeScript program is created. */
export const DEFAULT_SEMANTIC_PREFLIGHT_BUDGET = {
  maxFiles: 1_000,
  maxSourceBytes: 16 * 1024 * 1024,
  maxPreviousSourceExpansion: 1_000,
  maxDependencyClosureFiles: 5_000,
} as const satisfies IndexPatchBudget

export interface SemanticPreflightUsage {
  /** Number of files selected for semantic enrichment. */
  readonly fileCount: number
  /** Total UTF-8 bytes read from the reached local semantic source closure. */
  readonly sourceBytes: number
  /** Local source files reached from the selected semantic roots. */
  readonly dependencyClosureFiles: number
}

export interface SemanticPreflightResult {
  /** Budget usage that can be passed to `enforceIndexPatchBudget`. */
  readonly usage: SemanticPreflightUsage
  /** Completed or budget-crossing closure used by semantic cache identity. */
  readonly dependencyClosure: readonly string[]
}

/**
 * Merges caller-provided semantic budgets with the default preflight guardrails.
 *
 * Undefined budgets keep indexing bounded for unusually large projects while
 * explicit budgets let CLI/server callers tighten or relax individual limits.
 */
export function semanticBudgetWithDefaults(budget: IndexPatchBudget | undefined): IndexPatchBudget {
  return { ...DEFAULT_SEMANTIC_PREFLIGHT_BUDGET, ...budget }
}

/**
 * Measures selected semantic source files before TypeScript program creation.
 *
 * Missing or unreadable files contribute zero bytes but still count as reached
 * files. The semantic compiler remains responsible for source-level issues.
 */
export async function semanticPreflight(
  root: string,
  files: readonly string[],
  budget: IndexPatchBudget,
): Promise<SemanticPreflightResult> {
  const closure = await semanticDependencyClosure(root, files, {
    maxFiles: budget.maxDependencyClosureFiles,
    maxSourceBytes: budget.maxSourceBytes,
  })

  return {
    usage: {
      fileCount: files.length,
      sourceBytes: closure.sourceBytes,
      dependencyClosureFiles: closure.files.length,
    },
    dependencyClosure: closure.files,
  }
}
