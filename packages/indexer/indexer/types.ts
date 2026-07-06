import type { ProjectDefinition, ProjectDefinitionKind } from '@use-crux/core/project-index'
import type { SemanticSourceProfileFile } from './semantic/source-profile'

/**
 * Source-file dependency graph used by incremental planning and source-row projection.
 *
 * The graph is intentionally source-only: it records which files can affect another file's static
 * output, not semantic imports, package dependencies, or runtime edges. Incremental planners use it
 * to decide which cached file extractions must be invalidated after a source change.
 */
export interface SourceGraph {
  /** Absolute source file path -> absolute source files that participate in its static output. */
  dependenciesByFile: Map<string, string[]>
  /** Internal source-profile rows produced by the static phase for semantic handoff. */
  semanticProfileByFile?: Map<string, SemanticSourceProfileFile>
  /** Absolute source file path -> exported-interface hash for dependent invalidation cutoffs. */
  interfaceHashByFile?: Map<string, string>
}

/**
 * Unresolved static relation emitted by extractors before relation binding.
 *
 * A relation can target an authored variable/import binding or a known index id. `typeByTargetKind`
 * lets one authored reference map to a more specific relation after the target definition kind is
 * known.
 */
export interface StaticRelationRef {
  /** Fallback relation type used when the target kind does not require specialization. */
  type: string
  /** Optional relation type overrides once the target definition kind is known. */
  typeByTargetKind?: Partial<Record<ProjectDefinitionKind, string>>
  /** Explicit source definition id for relation refs emitted from child/derived definitions. */
  fromId?: string
  /** Source variable name used when the primary definition id should be inferred. */
  fromVariable?: string
  /** Target variable or import name to resolve during static relation binding. */
  toVariable?: string
  /** Target definition id when the extractor already knows the exact static target. */
  toId?: string
  /** Target definition id to use only when `toVariable` cannot bind to a known definition. */
  fallbackToId?: string
}

/**
 * Internal parser projection of one primary definition plus relation refs and folded children.
 *
 * This is a compatibility shape between the fact-first extraction boundary and the current static
 * relation resolver. It is not the public extension authoring model.
 */
export interface StaticFoundDefinition {
  /** Export/local variable name that anchors unresolved relation refs for this definition. */
  variableName: string
  /** Primary Project Index definition emitted by the extraction pass. */
  definition: ProjectDefinition
  /** Folded child definitions that should be indexed with the primary definition. */
  extraDefinitions?: ProjectDefinition[]
  /** Unresolved relation refs emitted by extractors before cross-file binding. */
  relationRefs: StaticRelationRef[]
}
