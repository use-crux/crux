/**
 * Convex Agent bridge helpers.
 *
 * This compatibility barrel keeps the existing `@crux/convex/agent` export
 * surface while the implementation lives in focused modules:
 *
 * - `facade.ts` preserves Convex Agent constructor and method shapes.
 * - `profile-facade.ts` owns Crux profile-backed helpers.
 * - `sdk-tools.ts` adapts and wraps tools.
 * - `default-driver.ts` binds the profile lifecycle to `@convex-dev/agent`.
 *
 * @module
 */

export { Agent } from './facade'
export type { ConvexAgentComponent } from './facade'
export { convexAgent, createAgent } from './profile-facade'
export type { ConvexAgentCompatibleDefinition } from './profile-facade'
export { convexTools, createTool, wrapConvexTool } from './sdk-tools'
export type { ConvexAgentTool, ConvexAgentToolOptions, ToolRecord } from './sdk-tools'
export type {
  ConvexAgentBaseConfig,
  ConvexAgentCallArgs,
  ConvexAgentConfig,
  ConvexAgentContextMessage,
  ConvexAgentModelConfig,
  ConvexAgentPassthroughOptions,
  ConvexAgentPrepareArgs,
  ConvexAgentPrepareMessages,
  ConvexAgentPrepareResult,
  ConvexAgentThreadTarget,
  CreateAgentOptions,
  CruxConvexAgent,
  CruxConvexThread,
} from './sdk-types'
