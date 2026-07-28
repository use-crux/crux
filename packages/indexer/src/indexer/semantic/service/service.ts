import { resolve } from 'node:path'
import { staticDefinitionFileSelection } from '../../files'
import { enforceIndexPatchBudget, type IndexPatch } from '../../patches'
import { degradedSemanticPatch, semanticFailureDiagnostic } from '../patch'
import {
  semanticBudgetWithDefaults,
  semanticPreflight,
  semanticPreflightFromDependencyClosure,
  semanticPreflightFromSourceProfile,
} from '../preflight'
import { semanticSupportSources } from '../../semantic-support'
import {
  measureSemanticTiming,
  measureSemanticTimingAsync,
} from '../instrumentation'
import { collectProjectedSemanticEvidence } from '../evidence/projection'
import { semanticProjectSessionIdentity } from './session'
import {
  createSemanticBackendFromSelection,
  semanticBackendSelectionFromEnv,
  semanticBackendSelectionFromProjectConfig,
} from './backend-selection'
import type {
  SemanticBackend,
  SemanticBackendOption,
  SemanticBackendSelection,
  SemanticCompilerRuntimeIdentity,
  SemanticIndexFilesInput,
  SemanticIndexProjectInput,
  SemanticIndexService,
  SemanticIndexServiceOptions,
} from './types'

/**
 * Creates a semantic indexing service.
 *
 * The returned service owns semantic selection, preflight budgets, backend
 * invocation, degradation, and patch shaping. Backend implementations only
 * produce facts for already selected files.
 */
export function createSemanticIndexService(
  options: SemanticIndexServiceOptions = {},
): SemanticIndexService {
  const backendCache = new Map<string, SemanticBackend>()
  const indexFiles = async (
    input: SemanticIndexFilesInput,
  ): Promise<IndexPatch> => {
    const root = resolve(input.root)
    const startedAt = input.startedAt ?? new Date().toISOString()
    const backend = await semanticBackendForInput(input, options, backendCache)
    const semanticBudget = semanticBudgetWithDefaults(input.semanticBudget)
    const basePatch = semanticBasePatch({
      root,
      configPath: input.configPath,
      projectName: input.projectName,
      startedAt,
      semanticBackend: backend.identity.name,
    })

    const selectionBudgetPatch = enforceIndexPatchBudget(
      basePatch,
      semanticBudget,
      {
        fileCount: input.files.length,
        previousSourceExpansion: input.previousSourceExpansion,
      },
    )
    if (selectionBudgetPatch.status === 'degraded') {
      return { ...selectionBudgetPatch, finishedAt: new Date().toISOString() }
    }

    if (input.files.length === 0) {
      return { ...basePatch, finishedAt: new Date().toISOString() }
    }

    const dependencyClosure = semanticDependencyClosureFromInput(input)
    const preflight = await measureSemanticTimingAsync(
      input.semanticInstrumentation,
      'semantic.preflight',
      () =>
        input.sourceProfile
          ? semanticPreflightFromSourceProfile(
              input.files,
              sourceProfileWithClosure(input.sourceProfile, dependencyClosure),
              semanticBudget,
            )
          : dependencyClosure
            ? semanticPreflightFromDependencyClosure(
                input.files,
                dependencyClosure,
                semanticBudget,
              )
            : semanticPreflight(root, input.files, semanticBudget),
    )
    const preflightUsage = {
      ...preflight.usage,
      previousSourceExpansion: input.previousSourceExpansion,
    }
    const fileBudgetPatch = enforceIndexPatchBudget(
      basePatch,
      semanticBudget,
      preflightUsage,
    )
    if (fileBudgetPatch.status === 'degraded') {
      return { ...fileBudgetPatch, finishedAt: new Date().toISOString() }
    }

    try {
      const compilerRuntime = await semanticCompilerRuntimeIdentity(
        backend,
        root,
      )
      const session = await backend.createSession({
        root,
        identity: semanticProjectSessionIdentity(root, {
          backend: backend.identity,
          compilerRuntime,
        }),
        instrumentation: input.semanticInstrumentation,
      })
      const facts = await collectProjectedSemanticEvidence(
        await session.analyze({
          root,
          files: input.files,
          dependencyClosure: preflight.dependencyClosure,
          sourceProfile: preflight.sourceProfile,
          instrumentation: input.semanticInstrumentation,
          semanticCache: input.semanticCache,
        }),
      )

      return enforceIndexPatchBudget(
        {
          ...basePatch,
          facts: {
            ...facts,
            sources: semanticSupportSources(
              input.previousIndex,
              facts.sourceRefs,
              facts.diagnostics,
            ),
            sourceGraph: input.previousIndex?.sourceGraph,
          },
          finishedAt: new Date().toISOString(),
        },
        semanticBudget,
        preflightUsage,
      )
    } catch (error) {
      return degradedSemanticPatch(basePatch, [
        semanticFailureDiagnostic(error),
      ])
    }
  }

  return {
    async indexProject(input: SemanticIndexProjectInput): Promise<IndexPatch> {
      const root = resolve(input.root)
      const selection = measureSemanticTiming(
        input.semanticInstrumentation,
        'semantic.selection',
        () => {
          const staticSelection = staticDefinitionFileSelection(root)
          return semanticFilesForIndex(
            staticSelection.files,
            input.previousIndex,
            input.sourceProfile,
          )
        },
      )

      return indexFiles({
        ...input,
        root,
        files: selection.files,
        sourceProfile: input.sourceProfile,
        previousSourceExpansion: selection.previousSourceExpansion,
      })
    },

    indexFiles,
  }
}

async function semanticCompilerRuntimeIdentity(
  backend: SemanticBackend,
  root: string,
): Promise<SemanticCompilerRuntimeIdentity> {
  return (
    (await backend.compilerRuntimeIdentity?.({
      root,
      backend: backend.identity,
    })) ?? {
      name: backend.identity.name,
      version: backend.identity.version,
    }
  )
}

function sourceProfileWithClosure(
  sourceProfile: NonNullable<SemanticIndexFilesInput['sourceProfile']>,
  dependencyClosure: readonly string[] | undefined,
): NonNullable<SemanticIndexFilesInput['sourceProfile']> {
  if (!dependencyClosure) return sourceProfile
  return {
    ...sourceProfile,
    dependencyClosure: [
      ...new Set([...sourceProfile.dependencyClosure, ...dependencyClosure]),
    ].sort(),
  }
}

function semanticDependencyClosureFromInput(
  input: SemanticIndexFilesInput,
): readonly string[] | undefined {
  return (
    input.dependencyClosure ??
    semanticDependencyClosureFromPreviousIndex(input.previousIndex, input.files)
  )
}

function semanticDependencyClosureFromPreviousIndex(
  previousIndex: SemanticIndexFilesInput['previousIndex'],
  files: readonly string[],
): readonly string[] | undefined {
  if (!previousIndex?.sourceGraph?.capabilities.includes('source-dependencies'))
    return undefined

  const sourceFiles = new Set(
    previousIndex.sources.map((source) => source.file),
  )
  const dependenciesByFile = new Map(
    previousIndex.sources.map(
      (source) => [source.file, source.dependencies ?? []] as const,
    ),
  )
  const seen = new Set<string>()
  const queue = [...files].sort()
  while (queue.length > 0) {
    const file = queue.shift()
    if (!file || seen.has(file)) continue
    seen.add(file)
    for (const dependency of dependenciesByFile.get(file) ?? []) {
      if (dependency && sourceFiles.has(dependency) && !seen.has(dependency))
        queue.push(dependency)
    }
    queue.sort()
  }
  return [...seen].sort()
}

async function semanticBackendForInput(
  input: SemanticIndexProjectInput,
  options: SemanticIndexServiceOptions,
  cache: Map<string, SemanticBackend>,
): Promise<SemanticBackend> {
  const option =
    input.semanticBackend ??
    options.backend ??
    semanticBackendSelectionFromEnv(options.env ?? process.env) ??
    (await semanticBackendSelectionFromProjectConfig(
      resolve(input.root),
      input.configPath,
    )) ??
    'typescript'
  const cacheKey = semanticBackendCacheKey(option)
  const cached = cache.get(cacheKey)
  if (cached) return cached
  const backend = createSemanticBackendFromSelection(option)
  cache.set(cacheKey, backend)
  return backend
}

function semanticBackendCacheKey(
  option: SemanticBackendOption | SemanticBackendSelection,
): string {
  if (typeof option === 'string') return option
  if ('identity' in option)
    return `custom:${option.identity.name}:${option.identity.version}`
  return JSON.stringify(option)
}

interface SemanticBasePatchInput {
  readonly root: string
  readonly configPath?: string
  readonly projectName?: string
  readonly startedAt: string
  readonly semanticBackend: string
}

function semanticBasePatch(input: SemanticBasePatchInput): IndexPatch {
  return {
    schemaVersion: 1,
    phase: 'semantic',
    project: {
      root: input.root,
      ...(input.projectName ? { name: input.projectName } : {}),
      ...(input.configPath ? { configFile: input.configPath } : {}),
    },
    startedAt: input.startedAt,
    status: 'ok',
    semanticBackend: input.semanticBackend,
    facts: {},
  }
}

function semanticFilesForIndex(
  staticFiles: readonly string[],
  previousIndex: SemanticIndexProjectInput['previousIndex'],
  sourceProfile: SemanticIndexProjectInput['sourceProfile'],
): {
  readonly files: readonly string[]
  readonly previousSourceExpansion: number
} {
  const staticFileSet = new Set(staticFiles)
  const previousFiles =
    previousIndex?.sources.map((source) => source.file) ?? []
  const files = semanticRootFilesFromSourceProfile(
    [...new Set([...staticFiles, ...previousFiles])].sort(),
    sourceProfile,
  )
  const selectedFileSet = new Set(files)
  const previousExpansion = new Set(
    previousFiles.filter((file) => !staticFileSet.has(file)),
  )
  return {
    files,
    previousSourceExpansion: [...previousExpansion].filter((file) =>
      selectedFileSet.has(file),
    ).length,
  }
}

function semanticRootFilesFromSourceProfile(
  files: readonly string[],
  sourceProfile: SemanticIndexProjectInput['sourceProfile'],
): readonly string[] {
  if (!sourceProfile) return files
  const profilesByFile = new Map(
    sourceProfile.files.map((file) => [file.file, file]),
  )
  return files.filter((file) =>
    isSemanticRootSourceProfile(profilesByFile.get(file)),
  )
}

function isSemanticRootSourceProfile(
  profile:
    | NonNullable<SemanticIndexProjectInput['sourceProfile']>['files'][number]
    | undefined,
): boolean {
  if (!profile?.hints) return true
  const hasCurrentShapeHints =
    profile.hints.cruxCallNames !== undefined ||
    profile.hints.hasZodObject !== undefined ||
    profile.hints.nativeDirectCruxCandidate !== undefined
  if (!hasCurrentShapeHints) return true
  return (profile.hints.cruxCallNames?.length ?? 0) > 0
}
