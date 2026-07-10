import type { IndexPatchBudget } from '../patches'
import { compareCodepoint } from '../sort'
import { semanticSourceProfile, type SemanticSourceProfile, type SemanticSourceProfileFile } from './source-profile'

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
  /** Source text, hashes, and byte counts collected for this preflight. */
  readonly sourceProfile: SemanticSourceProfile
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
  const sourceProfile = await semanticSourceProfile(root, files, {
    maxFiles: budget.maxDependencyClosureFiles,
    maxSourceBytes: budget.maxSourceBytes,
  })

  return {
    usage: {
      fileCount: files.length,
      sourceBytes: sourceProfile.sourceBytes,
      dependencyClosureFiles: sourceProfile.dependencyClosure.length,
    },
    dependencyClosure: sourceProfile.dependencyClosure,
    sourceProfile,
  }
}

/**
 * Measures a caller-provided semantic source closure without reparsing imports.
 *
 * The caller is responsible for proving the closure from trusted source-graph
 * evidence. This function preserves the same budget/cache accounting as normal
 * preflight while avoiding duplicate dependency discovery.
 */
export async function semanticPreflightFromDependencyClosure(
  files: readonly string[],
  dependencyClosure: readonly string[],
  budget: IndexPatchBudget = {},
): Promise<SemanticPreflightResult> {
  const sourceProfile = await semanticSourceProfile('', files, {
    dependencyClosure,
    maxFiles: budget.maxDependencyClosureFiles,
    maxSourceBytes: budget.maxSourceBytes,
  })

  return {
    usage: {
      fileCount: files.length,
      sourceBytes: sourceProfile.sourceBytes,
      dependencyClosureFiles: sourceProfile.dependencyClosure.length,
    },
    dependencyClosure: sourceProfile.dependencyClosure,
    sourceProfile,
  }
}

/**
 * Reuses caller-provided source profile rows, reading only missing closure
 * entries before semantic backend setup.
 */
export async function semanticPreflightFromSourceProfile(
  files: readonly string[],
  sourceProfile: SemanticSourceProfile,
  budget: IndexPatchBudget = {},
): Promise<SemanticPreflightResult> {
  const completed = await completeSemanticSourceProfile(files, sourceProfile, budget)
  return {
    usage: {
      fileCount: files.length,
      sourceBytes: completed.sourceBytes,
      dependencyClosureFiles: completed.dependencyClosure.length,
    },
    dependencyClosure: completed.dependencyClosure,
    sourceProfile: completed,
  }
}

async function completeSemanticSourceProfile(
  files: readonly string[],
  sourceProfile: SemanticSourceProfile,
  budget: IndexPatchBudget,
): Promise<SemanticSourceProfile> {
  const dependencyClosure = [...new Set([...sourceProfile.dependencyClosure, ...files])].sort()
  if (budget.maxDependencyClosureFiles !== undefined && dependencyClosure.length > budget.maxDependencyClosureFiles) {
    return { ...sourceProfile, dependencyClosure, complete: false }
  }

  const profileByFile = new Map(sourceProfile.files.map((file) => [file.file, file]))
  const missingFiles = dependencyClosure.filter((file) => !profileByFile.has(file))
  const existingClosureSourceBytes = dependencyClosure.reduce(
    (sum, file) => sum + (profileByFile.get(file)?.sourceBytes ?? 0),
    0,
  )
  const missingProfile =
    missingFiles.length > 0
      ? await semanticSourceProfile('', missingFiles, {
          dependencyClosure: missingFiles,
          maxFiles: budget.maxDependencyClosureFiles,
          maxSourceBytes:
            budget.maxSourceBytes === undefined
              ? undefined
              : Math.max(0, budget.maxSourceBytes - existingClosureSourceBytes),
        })
      : undefined

  for (const file of missingProfile?.files ?? []) {
    profileByFile.set(file.file, file)
  }

  const profileFiles = dependencyClosure.flatMap((file) => profileByFile.get(file) ?? []).sort(compareProfileFiles)
  const sourceBytes = profileFiles.reduce((sum, file) => sum + file.sourceBytes, 0)
  return {
    files: profileFiles,
    dependencyClosure,
    sourceBytes,
    complete:
      dependencyClosure.every((file) => profileByFile.has(file)) &&
      (budget.maxSourceBytes === undefined || sourceBytes <= budget.maxSourceBytes),
  }
}

function compareProfileFiles(left: SemanticSourceProfileFile, right: SemanticSourceProfileFile): number {
  return compareCodepoint(left.file, right.file)
}
