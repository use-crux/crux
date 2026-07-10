/**
 * Static Index host facade.
 *
 * This module is for Crux-owned workers and local runtime bridges that need to
 * inspect source-file selection and Static Index planning. Source patch
 * production is owned by the Go/Rust Static Index compiler path; this facade
 * intentionally does not expose an in-process TypeScript projection pipeline.
 *
 * @module
 */

export { staticDefinitionFiles } from '../indexer/files'
export { inspectProjectStaticIndexConfig } from '../indexer/static-index/config/inspect'
export { inspectProjectStaticSyntaxPlan } from '../indexer/static-index/plan'

export type {
  InspectProjectStaticIndexConfigOptions,
  ProjectStaticIndexConfig,
  ProjectStaticIndexExtensionReference,
} from '../indexer/static-index/config/inspect'
export type { InspectProjectStaticSyntaxPlanOptions, ProjectStaticSyntaxPlan } from '../indexer/static-index/plan'
