/**
 * Static Index host facade.
 *
 * This module is for Crux-owned workers and local runtime bridges that need to
 * run the source-only Project Index lane or compare static syntax frontends.
 * It exposes compiler-owned facades and JSON-safe Static Syntax contracts
 * without exporting parser-native AST objects.
 *
 * @module
 */

export {
  astIndexPatchFromCompilerResult,
  compileProjectIndex,
  createProjectIndexCompiler,
  projectIndexSnapshotFromCompilerResult,
} from '../indexer/compiler'
export { createStaticExtraction } from '../indexer/static/extraction/engine'
export { staticDefinitionFiles } from '../indexer/files'
export { createTypeScriptStaticSyntaxFrontend } from '../indexer/static-index/syntax'
export {
  indexProjectAstFromSyntaxRecordProviderForHost,
  indexProjectAstFromSyntaxRecordsForHost,
} from '../indexer'

export type {
  ProjectIndexCompileMode,
  ProjectIndexCompiler,
  ProjectIndexCompilerInput,
  ProjectIndexCompilerResult,
} from '../indexer/compiler'
export type { CompilerOwnedProjection, ProjectIndexCompilerProfile } from '../indexer/compiler/profile'
export type {
  SourceReader,
  StaticExtractionEngine,
  StaticExtractionInstrumentation,
  StaticExtractionOptions,
  StaticFileExtraction,
} from '../indexer/static/extraction/engine'
export type {
  StaticParseCacheHit,
  StaticParseCacheStore,
} from '../indexer/static/extraction/types'
export type {
  IndexProjectAstFromSyntaxRecordProviderHostOptions,
  IndexProjectAstFromSyntaxRecordsHostOptions,
} from '../indexer'
export type {
  NativeFactProjectionMode,
  ProvidedStaticSyntaxRecordProvider,
  StaticSyntaxFileRecord,
  StaticSyntaxFrontendIdentity,
  StaticSyntaxFrontendFactory,
} from '../indexer/static-index/syntax'
