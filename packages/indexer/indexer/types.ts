import type {
  IndexDiagnostic,
  ProjectDefinition,
  ProjectDefinitionKind,
  ProjectRelation,
} from '@crux/core/project-index'

/**
 * Projected static parser output consumed by compiler discovery and patch builders.
 *
 * This is the current index-facing projection after fact extraction and relation resolution. It is
 * intentionally separate from `ExtractedFacts` so the extension boundary can evolve without forcing
 * downstream index consumers to understand intermediate compiler facts.
 */
export interface StaticParseResult {
  definitions: ProjectDefinition[]
  relations: ProjectRelation[]
  diagnostics: IndexDiagnostic[]
  dependencies: string[]
}

/**
 * Fact-first static parser output before final index projection.
 *
 * It contains source-local facts, path-derived definitions, imported definitions needed for relation
 * binding, and source dependencies for cache/source graph construction.
 */
export interface StaticFactParseResult {
  facts: ExtractedFacts[]
  pathDefinitions: ProjectDefinition[]
  importedDefinitions: Map<string, ProjectDefinition>
  diagnostics: IndexDiagnostic[]
  dependencies: string[]
}

/** Minimal source dependency graph used by incremental planning and source-row projection. */
export interface SourceGraph {
  dependenciesByFile: Map<string, string[]>
}

/**
 * Unresolved static relation emitted by extractors before relation binding.
 *
 * A relation can target an authored variable/import binding or a known index id. `typeByTargetKind`
 * lets one authored reference map to a more specific relation after the target definition kind is
 * known.
 */
export interface StaticRelationRef {
  type: string
  typeByTargetKind?: Partial<Record<ProjectDefinitionKind, string>>
  fromId?: string
  fromVariable?: string
  toVariable?: string
  toId?: string
}

/**
 * Internal parser projection of one primary definition plus relation refs and folded children.
 *
 * This is a compatibility shape between the fact-first extraction boundary and the current static
 * relation resolver. It is not the public extension authoring model.
 */
export interface StaticFoundDefinition {
  variableName: string
  definition: ProjectDefinition
  extraDefinitions?: ProjectDefinition[]
  relationRefs: StaticRelationRef[]
}

/**
 * Resolved import binding for an identifier visible in a source file.
 *
 * `moduleSpecifier` preserves the authored import string so `ExtractPattern.importFrom` can avoid
 * matching same-named local helpers from unrelated modules.
 */
export interface ImportBinding {
  importedName: string
  file: string
  moduleSpecifier: string
}
