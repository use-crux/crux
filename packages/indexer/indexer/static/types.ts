import type {
  IndexDiagnostic,
  ProjectDefinition,
  ProjectRelation,
} from '@crux/core/project-index'
import type { ExtractedFacts } from '../extensions'

/**
 * Index-facing result for a single source file after static extraction, relation binding, and
 * read-model enrichment have completed.
 *
 * This is the shape consumed by discovery, incremental planning, and patch builders. It deliberately
 * hides extractor-internal facts so callers can treat static extraction as a deterministic compiler
 * phase: a file plus a fixed extension runtime produces definitions, relations, diagnostics, and the
 * source-file dependencies that must invalidate the result.
 */
export interface StaticParseResult {
  /** Definitions proven by the static compiler phase for this file. */
  definitions: ProjectDefinition[]
  /** Relations resolved from source-local and imported static references. */
  relations: ProjectRelation[]
  /** Extraction and projection diagnostics that should be surfaced with the file's index facts. */
  diagnostics: IndexDiagnostic[]
  /** Direct source-file dependencies whose text can change this result. */
  dependencies: string[]
}

/**
 * Fact-first output for a source file before it is projected into the index read model.
 *
 * The parser uses this intermediate value to keep extraction, cross-file relation binding, and
 * path-derived prompt/context projections separate. Extension authors work with `ExtractedFacts`;
 * compiler callers should usually prefer `StaticParseResult`.
 */
export interface StaticFactParseResult {
  /** Raw extension/compiler facts emitted before relation resolution. */
  facts: ExtractedFacts[]
  /** Definitions created from authored prompt/context tree paths after source-local extraction. */
  pathDefinitions: ProjectDefinition[]
  /** Imported definitions keyed by local import name for same-pass relation binding. */
  importedDefinitions: Map<string, ProjectDefinition>
  /** Diagnostics collected while extracting facts, including degraded static analysis results. */
  diagnostics: IndexDiagnostic[]
  /** Direct source-file dependencies discovered during fact extraction. */
  dependencies: string[]
}
