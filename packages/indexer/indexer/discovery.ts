import type {
  IndexDiagnostic,
  IndexSourceFile,
  ProjectDefinition,
  ProjectIdentity,
  ProjectRelation,
  PromptMeta,
} from '@use-crux/core/project-index'
import type { LoadedProjectConfig } from './config'
import { discoverRuntimeEvalDefinitions } from './eval-discovery'
import { evalGlobs } from './files'
import { discoverResolvedDefinitionsFromStaticCandidates, discoverStaticDefinitions } from './static/discovery'
import type { StaticExtractionEngine } from './static/extraction/engine'
import type { ProjectShardFileBatch } from './shards/types'
import type { SourceGraph } from './types'

export interface ProjectDiscoveryResult {
  readonly definitions: readonly ProjectDefinition[]
  readonly relations: readonly ProjectRelation[]
  readonly diagnostics: readonly IndexDiagnostic[]
  readonly sources: readonly IndexSourceFile[]
  readonly sourceGraph: SourceGraph
}

export interface ProjectDiscoveryInput {
  readonly root: string
  readonly loaded: LoadedProjectConfig
  readonly project: ProjectIdentity
  readonly initialFacts: {
    readonly prompts: readonly PromptMeta[]
    readonly definitions: readonly ProjectDefinition[]
    readonly relations: readonly ProjectRelation[]
  }
  readonly diagnostics: readonly IndexDiagnostic[]
  readonly sources: readonly IndexSourceFile[]
  readonly staticFiles: readonly string[]
  readonly staticFileBatches?: readonly ProjectShardFileBatch[]
  readonly extraction: StaticExtractionEngine
}

export async function discoverProjectDefinitions(input: ProjectDiscoveryInput): Promise<ProjectDiscoveryResult> {
  const { root, loaded, initialFacts, staticFiles, extraction } = input
  const diagnostics: IndexDiagnostic[] = [...input.diagnostics]
  let sources = input.sources
  const definitions: ProjectDefinition[] = []
  const relations: ProjectRelation[] = []
  const localDiagnostics: IndexDiagnostic[] = []
  const sourceGraph: SourceGraph = {
    dependenciesByFile: new Map(),
    semanticProfileByFile: new Map(),
    interfaceHashByFile: new Map(),
  }
  const promptIds = new Set(
    initialFacts.prompts.map((prompt) => prompt.id).filter((id): id is string => typeof id === 'string'),
  )

  const failedImportFiles: string[] = []
  if (loaded.sourceImports) {
    const evalResult = await discoverRuntimeEvalDefinitions(root, evalGlobs(loaded), promptIds, sources)
    definitions.push(...evalResult.definitions)
    relations.push(...evalResult.relations)
    diagnostics.push(...evalResult.diagnostics)
    failedImportFiles.push(...evalResult.failedImportFiles)
    sources = evalResult.sources

    const resolvedRich = await discoverResolvedDefinitionsFromStaticCandidates(root, sources, staticFiles, extraction, {
      staticFileBatches: input.staticFileBatches,
    })
    definitions.push(...resolvedRich.definitions)
    relations.push(...resolvedRich.relations)
    diagnostics.push(...resolvedRich.diagnostics)
    failedImportFiles.push(...resolvedRich.failedImportFiles)
    sources = resolvedRich.sources
    mergeSourceGraph(sourceGraph, resolvedRich.sourceGraph)
  }

  const knownDefinitionIds = new Set([
    ...initialFacts.definitions.map((definitionItem) => definitionItem.id),
    ...definitions.map((definitionItem) => definitionItem.id),
  ])
  const staticResult = await discoverStaticDefinitions(
    root,
    loaded,
    { definitions: initialFacts.definitions, relations: initialFacts.relations },
    failedImportFiles,
    sources,
    knownDefinitionIds,
    staticFiles,
    extraction,
    { staticFileBatches: input.staticFileBatches },
  )
  definitions.push(...staticResult.definitions)
  relations.push(...staticResult.relations)
  localDiagnostics.push(...staticResult.diagnostics)
  sources = staticResult.sources
  mergeSourceGraph(sourceGraph, staticResult.sourceGraph)

  return {
    definitions,
    relations,
    diagnostics: [...diagnostics, ...localDiagnostics],
    sources,
    sourceGraph,
  }
}

function mergeSourceGraph(target: SourceGraph, incoming: SourceGraph): void {
  for (const [file, dependencies] of incoming.dependenciesByFile) {
    target.dependenciesByFile.set(
      file,
      [...new Set([...(target.dependenciesByFile.get(file) ?? []), ...dependencies])].sort(),
    )
  }
  for (const [file, profile] of incoming.semanticProfileByFile ?? []) {
    target.semanticProfileByFile?.set(file, profile)
  }
  for (const [file, interfaceHash] of incoming.interfaceHashByFile ?? []) {
    target.interfaceHashByFile?.set(file, interfaceHash)
  }
}
