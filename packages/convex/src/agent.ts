/**
 * Convex Agent bridge helpers.
 *
 * Public barrel for the Convex-Agent-compatible Crux integration. The concrete
 * `@convex-dev/agent` adapter lives under `./agent/sdk` so this facade stays
 * small while preserving the existing `@use-crux/convex/agent` import path.
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
  ConvexAgentCruxConfig,
  ConvexAgentCruxRuntimeConfig,
  ConvexAgentDriver,
  ConvexAgentModelConfig,
  ConvexAgentObserveArgs,
  ConvexAgentObserveConfig,
  ConvexAgentPassthroughOptions,
  ConvexAgentPrepareArgs,
  ConvexAgentPrepareMessages,
  ConvexAgentPrepareResult,
  ConvexAgentPersistenceConfig,
  ConvexAgentThreadTarget,
  ConvexGenerateObjectArgs,
  ConvexGenerateObjectOptions,
  ConvexGenerateObjectResult,
  ConvexGenerateTextArgs,
  ConvexGenerateTextOptions,
  ConvexGenerateTextResult,
  ConvexStreamObjectArgs,
  ConvexStreamObjectOptions,
  ConvexStreamObjectResult,
  ConvexStreamTextArgs,
  ConvexStreamTextOptions,
  ConvexStreamTextResult,
  ConvexThreadGenerateObjectArgs,
  ConvexThreadGenerateObjectOptions,
  ConvexThreadGenerateObjectResult,
  ConvexThreadGenerateTextArgs,
  ConvexThreadGenerateTextOptions,
  ConvexThreadGenerateTextResult,
  ConvexThreadStreamObjectArgs,
  ConvexThreadStreamObjectOptions,
  ConvexThreadStreamObjectResult,
  ConvexThreadStreamTextArgs,
  ConvexThreadStreamTextOptions,
  ConvexThreadStreamTextResult,
  CreateAgentOptions,
  CruxConvexAgent,
  CruxConvexThread,
} from './agent/sdk'
