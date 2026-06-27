/**
 * Runtime Index host facade.
 *
 * Runtime-rich indexing uses the same compiler result model as source indexing
 * but emits a runtime patch with a distinct producer and invalidation shape.
 * This host-only entry point exposes that conversion without widening the root
 * SDK surface.
 *
 * @module
 */

export { runtimeIndexPatchFromCompilerResult } from '../indexer/compiler'
export type { ProjectIndexCompilerResult } from '../indexer/compiler'

