/**
 * Resolved Project Model facade for local Crux tooling.
 *
 * The resolver is intentionally a read-model boundary: callers ask one public
 * function what Crux can see, and the implementation hides config loading,
 * source indexing, package metadata, ignored conventions, and Quality defaults.
 *
 * @module
 */

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type {
  IndexDiagnostic,
  ProjectConfigFile,
  ProjectConfigFileStatus,
  ProjectDefinition,
  ProjectModelDefinition,
  ProjectModelField,
  ProjectModelProvenance,
  ProjectModelRelation,
  ProjectModelResolutionMode,
  ProjectModelQuality,
  ProjectModelVisibility,
  ProjectRelation,
  ResolvedProjectModel,
  SourceLocation,
} from '@use-crux/core/project-index'
import { createProjectModelDefinitionId, createProjectModelRelationId } from '@use-crux/core/project-index'
import { indexDefinitionsFromSnapshot, serializeIndex } from '@use-crux/core/project-index/serializers'
import { loadProjectConfig } from './config'
import { findConfigFiles } from './files'
import { projectModelDiagnostics } from './project-model-diagnostics'
import { projectModelDefinitionMetadata } from './project-model-metadata'
import { DEFAULT_PROJECT_MODEL_RESOLUTION_MODE } from './resolution-mode'
import { compareCodepoint } from './sort'

const DEFAULT_QUALITY_INCLUDE = ['evals/**/*.eval.ts', '**/*.eval.ts'] as const
const DEFAULT_IGNORED_PATHS = [
  '**/node_modules/**',
  '**/.git/**',
  '**/.cache/**',
  '**/.next/**',
  '**/.turbo/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/generated/**',
] as const

/** Options for resolving the local Project Model read model. */
export interface ResolveProjectModelOptions {
  /** Project root used for source discovery and filesystem conventions. */
  readonly root: string
  /** Optional Crux config path, relative to `root` unless already absolute. */
  readonly configPath?: string
  /** Optional project name supplied by an embedding CLI or server. */
  readonly projectName?: string
  /**
   * Controls how much evidence the resolver may gather.
   *
   * Defaults to `config-policy`: config may be loaded, but authored source
   * modules are not imported unless a caller explicitly asks for `runtime-rich`.
   */
  readonly resolutionMode?: ProjectModelResolutionMode
}

/**
 * Resolve the local Project Model for a Crux project.
 *
 * Use this facade when tooling needs to explain what Crux inferred versus what
 * was provided explicitly. The returned object is JSON-safe and follows the
 * public `@use-crux/core/project-index` Project Model contract.
 */
export async function resolveProjectModel(options: ResolveProjectModelOptions): Promise<ResolvedProjectModel> {
  const root = resolve(options.root)
  const resolutionMode = options.resolutionMode ?? DEFAULT_PROJECT_MODEL_RESOLUTION_MODE
  const { loaded, diagnostics: configDiagnostics } = await loadProjectConfig(root, options.configPath, resolutionMode)
  const configIndex = serializeIndex(
    loaded.crux?.prompts ? [...loaded.crux.prompts] : [],
    loaded.crux?.contexts ? [...loaded.crux.contexts] : [],
    undefined,
  )
  const configFacts = indexDefinitionsFromSnapshot(configIndex)
  const diagnostics = [...configFacts.diagnostics, ...configDiagnostics]
  const configFiles = projectConfigFiles(root, options.configPath, resolutionMode, diagnostics)
  const packageName = packageNameField(root)
  const definitions = configFacts.definitions.map(projectModelDefinition)
  const relationDefinitions = new Map(
    configFacts.definitions.map((definition) => [definition.id, definition]),
  )
  const relations = configFacts.relations.map((relation) =>
    projectModelRelation(relation, relationDefinitions),
  )

  return {
    root: field(root, filesystemProvenance(root, 'resolved project root')),
    resolutionMode: field(resolutionMode, runtimeProvenance('project-model.resolutionMode')),
    ...(packageName ? { packageName } : {}),
    configFiles,
    sourceRoots: [field(root, filesystemProvenance(root, 'project source root'))],
    ignoredPaths: DEFAULT_IGNORED_PATHS.map((path) => field(path, filesystemProvenance(root, 'default ignored path'))),
    definitions,
    relations,
    quality: projectModelQuality(root, packageName, definitions),
    diagnostics: projectModelDiagnostics(
      root,
      configFiles,
      diagnostics,
      [],
      configFacts.definitions,
      configFacts.relations,
    ),
  }
}

function projectConfigFiles(
  root: string,
  configPath: string | undefined,
  resolutionMode: ProjectModelResolutionMode,
  diagnostics: readonly IndexDiagnostic[],
): readonly ProjectConfigFile[] {
  const explicitConfig = configPath ? resolve(root, configPath) : undefined
  if (explicitConfig && !existsSync(explicitConfig)) {
    const provenance = cliProvenance('--config')
    return [
      {
        path: field(explicitConfig, provenance),
        status: field('missing', provenance),
      },
    ]
  }
  const configFiles = explicitConfig ? [explicitConfig] : findConfigFiles(root)
  if (configFiles.length === 0) {
    const provenance = filesystemProvenance(root, 'crux config search')
    return [
      {
        path: field(join(root, 'crux.config.ts'), provenance),
        status: field('missing', provenance),
      },
    ]
  }

  const importFailedFiles = new Set(
    diagnostics
      .filter((diagnostic) => diagnostic.code === 'index.config_import_failed')
      .map((diagnostic) => diagnostic.source?.file)
      .filter((file): file is string => typeof file === 'string'),
  )

  return configFiles.map((configFile, index): ProjectConfigFile => {
    const pathProvenance = explicitConfig
      ? cliProvenance('--config')
      : filesystemProvenance(configFile, 'crux config discovery')
    const status = configStatusFor(configFile, index, importFailedFiles, resolutionMode)
    return {
      path: field(configFile, pathProvenance),
      status: field(
        status,
        status === 'ignored' ? filesystemProvenance(configFile, 'extra config ignored') : pathProvenance,
      ),
    }
  })
}

function configStatusFor(
  configFile: string,
  index: number,
  importFailedFiles: ReadonlySet<string>,
  resolutionMode: ProjectModelResolutionMode,
): ProjectConfigFileStatus {
  if (index > 0) return 'ignored'
  if (importFailedFiles.has(configFile)) return 'import-failed'
  if (resolutionMode === 'source-only') return 'source-only'
  return 'loaded'
}

function projectModelQuality(
  root: string,
  packageName: ProjectModelField<string> | undefined,
  definitions: readonly ProjectModelDefinition[],
): ProjectModelQuality {
  return {
    ...(packageName ? { id: packageName } : {}),
    persistenceRoot: field(join(root, '.crux/quality'), filesystemProvenance(root, 'default quality persistence root')),
    includeGlobs: DEFAULT_QUALITY_INCLUDE.map((glob) =>
      field(glob, filesystemProvenance(root, 'default quality include')),
    ),
    excludeGlobs: [],
    evaluationFiles: evaluationFiles(definitions),
  }
}

function evaluationFiles(definitions: readonly ProjectModelDefinition[]): readonly ProjectModelField<string>[] {
  const files = new Map<string, ProjectModelField<string>>()
  for (const definition of definitions) {
    if (definition.kind !== 'evaluation' || !definition.source?.file) continue
    files.set(definition.source.file, field(definition.source.file, sourceProvenance(definition.source)))
  }
  return [...files.values()].sort((left, right) => compareCodepoint(left.value, right.value))
}

function projectModelDefinition(definition: ProjectDefinition): ProjectModelDefinition {
  const exportName = definitionExportName(definition)
  const provenance = definition.source
    ? sourceProvenance(definition.source, exportName)
    : runtimeProvenance('project-index')
  const metadata = projectModelDefinitionMetadata(definition)
  return {
    id: createProjectModelDefinitionId(definition.id),
    kind: definition.kind,
    ...(definition.name ? { name: field(definition.name, provenance) } : {}),
    ...(definition.path ? { path: field([...definition.path], provenance) } : {}),
    ...(definition.source ? { source: definition.source } : {}),
    visibility: field<ProjectModelVisibility>('inferred', provenance),
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  }
}

function projectModelRelation(
  relation: ProjectRelation,
  definitionsById: ReadonlyMap<string, ProjectDefinition>,
): ProjectModelRelation {
  const owner = definitionsById.get(relation.from)
  const source = relation.source ?? owner?.source
  const exportName = owner ? definitionExportName(owner) : undefined
  const provenance = source ? sourceProvenance(source, exportName) : runtimeProvenance('project-index.relation')
  const metadata: Record<string, unknown> = {
    fidelity: relation.fidelity,
    ...(relation.metadata ?? {}),
  }

  return {
    id: createProjectModelRelationId(relation.id),
    type: relation.type,
    from: createProjectModelDefinitionId(relation.from),
    to: createProjectModelDefinitionId(relation.to),
    ...(source ? { source } : {}),
    visibility: field<ProjectModelVisibility>('inferred', provenance),
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  }
}

function definitionExportName(definition: ProjectDefinition): string | undefined {
  const exportName = definition.metadata?.exportName
  return typeof exportName === 'string' && exportName.length > 0 ? exportName : undefined
}

function packageNameField(root: string): ProjectModelField<string> | undefined {
  const packageJson = join(root, 'package.json')
  if (!existsSync(packageJson)) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(packageJson, 'utf8'))
  } catch {
    return undefined
  }
  if (!hasPackageName(parsed)) return undefined
  return field(parsed.name, filesystemProvenance(packageJson, 'package.json name'))
}

function hasPackageName(value: unknown): value is { readonly name: string } {
  if (value === null || typeof value !== 'object') return false
  const name = (value as { readonly name?: unknown }).name
  return typeof name === 'string' && name.length > 0
}

function field<T>(value: T, provenance: ProjectModelProvenance): ProjectModelField<T> {
  return { value, provenance }
}

function sourceProvenance(source: SourceLocation, exportName?: string): ProjectModelProvenance {
  return { kind: 'source', file: source.file, ...(exportName ? { exportName } : {}) }
}

function filesystemProvenance(path: string, convention: string): ProjectModelProvenance {
  return { kind: 'filesystem', path, convention }
}

function runtimeProvenance(attribute: string): ProjectModelProvenance {
  return { kind: 'runtime', attribute }
}

function cliProvenance(flag: string): ProjectModelProvenance {
  return { kind: 'cli', flag }
}
