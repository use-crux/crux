/**
 * Resolved Project Model contract for local Crux tooling.
 *
 * The Project Model is a read model: it explains what Crux inferred from
 * source, runtime evidence, filesystem conventions, explicit config, and CLI
 * flags. It is not a runtime setup API and should not require users to repeat
 * authored prompts, contexts, tools, stores, memories, retrievers, flows, or
 * agents in central config just so local tools can see them.
 *
 * @module
 */

import type { ProjectDefinitionKind, SourceLocation } from './index'

type Brand<T, Name extends string> = T & { readonly __brand: Name }

/**
 * Stable id for a definition in a resolved Project Model.
 *
 * Branded ids prevent accidental mixing with diagnostic ids or arbitrary
 * strings while remaining plain strings when serialized across CLI, Go, and
 * devtools boundaries.
 */
export type ProjectModelDefinitionId = Brand<string, 'ProjectModelDefinitionId'>

/**
 * Stable id for a relation in a resolved Project Model.
 *
 * Relation ids use a separate brand from definition ids because they cross the
 * same JSON and worker boundaries while representing graph edges, not nodes.
 */
export type ProjectModelRelationId = Brand<string, 'ProjectModelRelationId'>

/**
 * Stable id for a user-facing Project Model diagnostic.
 *
 * The id identifies one diagnostic instance; use {@link ProjectModelDiagnosticCode}
 * for the stable reason code.
 */
export type ProjectModelDiagnosticId = Brand<string, 'ProjectModelDiagnosticId'>

/** Create a branded Project Model definition id at a construction boundary. */
export function createProjectModelDefinitionId(value: string): ProjectModelDefinitionId {
  return value as ProjectModelDefinitionId
}

/** Create a branded Project Model relation id at a construction boundary. */
export function createProjectModelRelationId(value: string): ProjectModelRelationId {
  return value as ProjectModelRelationId
}

/** Create a branded Project Model diagnostic id at a construction boundary. */
export function createProjectModelDiagnosticId(value: string): ProjectModelDiagnosticId {
  return value as ProjectModelDiagnosticId
}

/**
 * Project Model evidence-gathering modes.
 *
 * The mode controls what the resolver is allowed to load while producing the
 * read model. `config-policy` may import the selected Crux config, but authored
 * source modules remain execution-free.
 */
export const PROJECT_MODEL_RESOLUTION_MODES = ['source-only', 'config-policy', 'semantic', 'runtime-rich'] as const

/** Controls how much evidence Project Model resolution may gather. */
export type ProjectModelResolutionMode = (typeof PROJECT_MODEL_RESOLUTION_MODES)[number]

/** Stable Project Model diagnostic reason codes. */
export const PROJECT_MODEL_DIAGNOSTIC_CODES = [
  'project_model.dynamic_tool_map_unproven',
  'project_model.missing_stable_id',
  'project_model.prompt_test_dependency_unproven',
  'project_model.unknown_suite_target',
  'project_model.model_executor_missing',
  'project_model.source_skipped',
  'project_model.source_only_discovery',
  'project_model.config_import_failed',
] as const

/** Stable reason code for a Project Model diagnostic. */
export type ProjectModelDiagnosticCode = (typeof PROJECT_MODEL_DIAGNOSTIC_CODES)[number]

/** User-facing Project Model diagnostic severity. */
export type ProjectModelDiagnosticSeverity = 'info' | 'warning' | 'error'

/**
 * Provenance for a resolved Project Model field.
 *
 * Every inferred-or-overridden field should point at the source of truth that
 * made it visible. The union is intentionally JSON-safe and shallow for
 * worker and devtools transport.
 */
export type ProjectModelProvenance =
  | { readonly kind: 'source'; readonly file: string; readonly exportName?: string }
  | { readonly kind: 'runtime'; readonly traceId?: string; readonly attribute: string }
  | { readonly kind: 'filesystem'; readonly path: string; readonly convention: string }
  | { readonly kind: 'config'; readonly path: string; readonly key: string }
  | { readonly kind: 'cli'; readonly flag: string }

/** A Project Model value plus the provenance that selected it. */
export interface ProjectModelField<T> {
  readonly value: T
  readonly provenance: ProjectModelProvenance
}

/** Whether a visible Project Model fact was inferred or explicitly provided. */
export type ProjectModelVisibility = 'inferred' | 'explicit'

/** Status of a config file considered by Project Model resolution. */
export type ProjectConfigFileStatus = 'loaded' | 'missing' | 'import-failed' | 'ignored' | 'source-only'

/** Config file fact included in the resolved Project Model. */
export interface ProjectConfigFile {
  /** Absolute or project-relative config path, depending on the resolver boundary. */
  readonly path: ProjectModelField<string>
  /** How the resolver treated the config file. */
  readonly status: ProjectModelField<ProjectConfigFileStatus>
  /** Import or validation failure text, when status is `import-failed`. */
  readonly errorMessage?: string
}

/** One source-visible definition in the resolved Project Model. */
export interface ProjectModelDefinition {
  readonly id: ProjectModelDefinitionId
  readonly kind: ProjectDefinitionKind | (string & {})
  readonly name?: ProjectModelField<string>
  /**
   * Authored namespace path from source-discovered prompt/context bundles.
   *
   * For `createPrompts({ support: { answer } })`, the `answer` prompt carries
   * `["support", "answer"]` with provenance pointing at the exported prompt
   * definition that owns the path.
   */
  readonly path?: ProjectModelField<readonly string[]>
  readonly source?: SourceLocation
  readonly visibility: ProjectModelField<ProjectModelVisibility>
  readonly metadata?: Record<string, unknown>
}

/** Source-visible relationship between definitions in the resolved Project Model. */
export interface ProjectModelRelation {
  readonly id: ProjectModelRelationId
  readonly type: string
  readonly from: ProjectModelDefinitionId
  readonly to: ProjectModelDefinitionId
  readonly source?: SourceLocation
  readonly visibility: ProjectModelField<ProjectModelVisibility>
  readonly metadata?: Record<string, unknown>
}

/** Quality discovery and persistence settings in the resolved Project Model. */
export interface ProjectModelQuality {
  /** Effective Quality id, when explicit config or package metadata supplied one. */
  readonly id?: ProjectModelField<string>
  /** Effective persistence root for Quality artifacts. */
  readonly persistenceRoot: ProjectModelField<string>
  /** Effective include globs after config/default resolution. */
  readonly includeGlobs: readonly ProjectModelField<string>[]
  /** Effective exclude globs after config/default resolution. */
  readonly excludeGlobs: readonly ProjectModelField<string>[]
  /** Evaluation files discovered by source conventions. */
  readonly evaluationFiles: readonly ProjectModelField<string>[]
}

/** User-facing Project Model fact with a stable reason code and small fix. */
export interface ProjectModelDiagnostic {
  readonly id: ProjectModelDiagnosticId
  readonly code: ProjectModelDiagnosticCode
  readonly severity: ProjectModelDiagnosticSeverity
  readonly message: string
  readonly source?: SourceLocation
  readonly suggestedFix?: string
  readonly provenance?: ProjectModelProvenance
  readonly details?: Record<string, unknown>
}

/**
 * Resolved local view of a Crux project.
 *
 * This API is deliberately a read model. It combines source facts,
 * filesystem conventions, runtime evidence, and explicit policy/config while
 * preserving provenance for inferred versus explicit visibility.
 */
export interface ResolvedProjectModel {
  readonly root: ProjectModelField<string>
  /** Resolution mode that produced this read model. */
  readonly resolutionMode: ProjectModelField<ProjectModelResolutionMode>
  readonly packageName?: ProjectModelField<string>
  readonly configFiles: readonly ProjectConfigFile[]
  readonly sourceRoots: readonly ProjectModelField<string>[]
  readonly ignoredPaths: readonly ProjectModelField<string>[]
  readonly definitions: readonly ProjectModelDefinition[]
  readonly relations: readonly ProjectModelRelation[]
  readonly quality: ProjectModelQuality
  readonly diagnostics: readonly ProjectModelDiagnostic[]
}

const PROJECT_MODEL_DIAGNOSTIC_CODE_SET = new Set<string>(PROJECT_MODEL_DIAGNOSTIC_CODES)
const PROJECT_MODEL_RESOLUTION_MODE_SET = new Set<string>(PROJECT_MODEL_RESOLUTION_MODES)

/** Narrow unknown input from JSON or worker boundaries to a known diagnostic code. */
export function isProjectModelDiagnosticCode(value: unknown): value is ProjectModelDiagnosticCode {
  return typeof value === 'string' && PROJECT_MODEL_DIAGNOSTIC_CODE_SET.has(value)
}

/** Narrow unknown input from JSON or worker boundaries to a Project Model resolution mode. */
export function isProjectModelResolutionMode(value: unknown): value is ProjectModelResolutionMode {
  return typeof value === 'string' && PROJECT_MODEL_RESOLUTION_MODE_SET.has(value)
}

/** Narrow unknown input from JSON or worker boundaries to Project Model provenance. */
export function isProjectModelProvenance(value: unknown): value is ProjectModelProvenance {
  if (value === null || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  switch (candidate.kind) {
    case 'source':
      return (
        typeof candidate.file === 'string' &&
        (candidate.exportName === undefined || typeof candidate.exportName === 'string')
      )
    case 'runtime':
      return (
        typeof candidate.attribute === 'string' &&
        (candidate.traceId === undefined || typeof candidate.traceId === 'string')
      )
    case 'filesystem':
      return typeof candidate.path === 'string' && typeof candidate.convention === 'string'
    case 'config':
      return typeof candidate.path === 'string' && typeof candidate.key === 'string'
    case 'cli':
      return typeof candidate.flag === 'string'
    default:
      return false
  }
}
