import { Agent as ConvexAgent } from '@convex-dev/agent'
import { observeConvexAgentGeneration, observeConvexAgentTextStream } from './sdk-observability'
import { wrapToolRecord } from './sdk-tools'

/** Convex Agent component reference passed to the upstream `Agent` constructor. */
export type ConvexAgentComponent = ConstructorParameters<typeof ConvexAgent>[0]

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Used only to extract callable SDK method types.
type AnyFunction = (...args: any[]) => unknown
type ConvexAgentMethod<
  CustomCtx extends object,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mirrors Convex Agent's own ToolSet generic default.
  AgentTools extends Record<string, any>,
  TMethod extends keyof ConvexAgent<CustomCtx, AgentTools>,
> = Extract<ConvexAgent<CustomCtx, AgentTools>[TMethod], AnyFunction>

/**
 * Convex-Agent-compatible public facade with Crux observability and tool spans.
 *
 * The constructor and generation methods intentionally mirror
 * `@convex-dev/agent` so users can keep normal Convex Agent call shapes while
 * Crux wraps tools, spans, and runtime propagation behind the scenes.
 */
export class Agent<
  CustomCtx extends object = object,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Preserve Convex Agent generic compatibility.
  AgentTools extends Record<string, any> = any,
> extends ConvexAgent<CustomCtx, AgentTools> {
  /** Mirrors `@convex-dev/agent` while adding Crux observability. */
  declare generateText: ConvexAgentMethod<CustomCtx, AgentTools, 'generateText'>
  /** Mirrors `@convex-dev/agent` while adding Crux observability. */
  declare streamText: ConvexAgentMethod<CustomCtx, AgentTools, 'streamText'>
  /** Mirrors `@convex-dev/agent` while adding Crux observability. */
  declare generateObject: ConvexAgentMethod<CustomCtx, AgentTools, 'generateObject'>
  /** Mirrors `@convex-dev/agent` while adding Crux observability. */
  declare streamObject: ConvexAgentMethod<CustomCtx, AgentTools, 'streamObject'>

  constructor(
    component: ConvexAgentComponent,
    options: ConstructorParameters<typeof ConvexAgent<CustomCtx, AgentTools>>[1],
  ) {
    super(component, {
      ...options,
      tools: wrapToolRecord(options.tools) as AgentTools,
    })
  }
}

Agent.prototype.generateText = function (this: Agent, ...args: unknown[]) {
  return observeConvexAgentGeneration(
    this.options.name,
    'generation.call',
    'text',
    args,
    this.options.languageModel,
    () => Reflect.apply(ConvexAgent.prototype.generateText, this, args),
  )
} as Agent['generateText']

Agent.prototype.streamText = function (this: Agent, ...args: unknown[]) {
  return observeConvexAgentTextStream(this.options.name, args, this.options.languageModel, (patchedArgs) =>
    Reflect.apply(ConvexAgent.prototype.streamText, this, patchedArgs),
  )
} as Agent['streamText']

Agent.prototype.generateObject = function (this: Agent, ...args: unknown[]) {
  return observeConvexAgentGeneration(
    this.options.name,
    'generation.call',
    'object',
    args,
    this.options.languageModel,
    () => Reflect.apply(ConvexAgent.prototype.generateObject, this, args),
  )
} as Agent['generateObject']

Agent.prototype.streamObject = function (this: Agent, ...args: unknown[]) {
  return observeConvexAgentGeneration(
    this.options.name,
    'generation.stream',
    'object',
    args,
    this.options.languageModel,
    () => Reflect.apply(ConvexAgent.prototype.streamObject, this, args),
  )
} as Agent['streamObject']
