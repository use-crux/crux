/**
 * Static Index compiler surfaces.
 *
 * Static Index owns source-only Project Index planning, protocol contracts,
 * Static Syntax frontend selection, and the TypeScript compatibility host used
 * when extensions or rules still need JavaScript execution.
 *
 * @module
 */

export type { StaticIndexSyntaxFrontend, StaticIndexSyntaxSelection } from './config'
export { staticIndexSyntaxSelectionFromConfig } from './config'
export type {
  InspectProjectStaticIndexConfigOptions,
  ProjectStaticIndexConfig,
  ProjectStaticIndexExtensionReference,
} from './config/inspect'
export { inspectProjectStaticIndexConfig } from './config/inspect'
export type { InspectProjectStaticSyntaxPlanOptions, ProjectStaticSyntaxPlan } from './plan'
export { inspectProjectStaticSyntaxPlan } from './plan'
export * from './protocol'
export { OXC_STATIC_SYNTAX_FRONTEND_IDENTITY } from './syntax'
