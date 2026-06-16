/**
 * Convex Agent bridge helpers.
 *
 * Public barrel for the Convex-Agent-compatible Crux integration. The concrete
 * `@convex-dev/agent` adapter lives under `./agent/sdk` so this facade stays
 * small while preserving the existing `@crux/convex/agent` import path.
 *
 * @module
 */

export { Agent, convexAgent, convexTools, createAgent, createTool, wrapConvexTool } from './agent/sdk'

export type {
  ConvexAgentCallArgs,
  ConvexAgentBaseConfig,
  ConvexAgentComponent,
  ConvexAgentConfig,
  ConvexAgentContextMessage,
  ConvexAgentModelConfig,
  ConvexAgentPrepareArgs,
  ConvexAgentPrepareMessages,
  ConvexAgentPrepareResult,
  ConvexAgentThreadTarget,
  CreateAgentOptions,
  CruxConvexAgent,
  CruxConvexThread,
} from './agent/sdk'
