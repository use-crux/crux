import type { AnyToolSet } from '@use-crux/core'
import type { AnyConvexPrompt } from './lifecycle-types'
import { resolve as resolveAiAgent } from '@use-crux/ai/agent'
import { createProfileBackedAgentLifecycle } from './lifecycle'
import { createDefaultConvexAgentDriver } from './default-driver'
import { Agent, type ConvexAgentComponent } from './facade'
import type { ConvexAgentConfig, CreateAgentOptions, CruxConvexAgent } from './sdk-types'
import type {
  ConvexGenerateObjectResult,
  ConvexGenerateTextResult,
  ConvexStreamObjectResult,
  ConvexStreamTextResult,
} from './convex-agent-method-types'
import { convexTools, wrapToolRecord } from './sdk-tools'

/**
 * Create a Crux profile-backed Convex Agent helper.
 *
 * The returned helper preserves Convex Agent call shapes while resolving the
 * configured Crux prompt for every turn through the internal lifecycle driver.
 *
 * @param config - Prompt, model, component, tool, and lifecycle options.
 * @returns A Convex-Agent-shaped helper backed by Crux prompt resolution.
 */
export function convexAgent<TPrompt extends AnyConvexPrompt>(
  config: ConvexAgentConfig<TPrompt>,
): CruxConvexAgent<TPrompt> {
  const { crux, ...agentConfig } = config
  const lifecycle = createProfileBackedAgentLifecycle({
    ...agentConfig,
    prepare: crux?.prepare,
    storage: crux?.runtime?.storage,
    namespace: crux?.runtime?.namespace,
    observe: crux?.observe,
    persistence: crux?.persistence,
    driver: crux?.driver ?? createDefaultConvexAgentDriver(),
  })
  const resolve: CruxConvexAgent<TPrompt>['resolve'] = async (ctx, target, args) =>
    await lifecycle.resolveOnly({ ctx, target, args })
  return {
    name: lifecycle.name,
    prompt: config.prompt,
    crux: {
      resolve,
    },
    generateText: (async (ctx, target, args, options) =>
      (await lifecycle.invokeText({
        ctx,
        target,
        args,
        options: options as Record<string, unknown> | undefined,
      })) as Awaited<ConvexGenerateTextResult>) as CruxConvexAgent<TPrompt>['generateText'],
    streamText: (async (ctx, target, args, options) =>
      (await lifecycle.invokeStream({
        ctx,
        target,
        args,
        options: options as Record<string, unknown> | undefined,
      })) as Awaited<ConvexStreamTextResult>) as CruxConvexAgent<TPrompt>['streamText'],
    generateObject: (async (ctx, target, args, options) =>
      (await lifecycle.invokeObject({
        ctx,
        target,
        args,
        options: options as Record<string, unknown> | undefined,
      })) as Awaited<ConvexGenerateObjectResult>) as CruxConvexAgent<TPrompt>['generateObject'],
    streamObject: (async (ctx, target, args, options) =>
      (await lifecycle.invokeObjectStream({
        ctx,
        target,
        args,
        options: options as Record<string, unknown> | undefined,
      })) as Awaited<ConvexStreamObjectResult>) as CruxConvexAgent<TPrompt>['streamObject'],
    resolve,
    continueThread: async (ctx, target) => await lifecycle.continueThread({ ctx, target }),
  }
}

/**
 * Create a Crux-aware Convex Agent from a prompt or agent-like definition.
 *
 * This is the lower-level convenience path for apps that want a concrete
 * `Agent` instance instead of the profile-backed lifecycle helper. It resolves
 * the definition once, infers prompt tools, wraps direct Convex Agent tools, and
 * returns the normal Convex Agent facade.
 *
 * @param component - Convex Agent component reference.
 * @param definition - Crux prompt or agent-like definition to resolve.
 * @param options - Model, input, token budget, name, and extra tool options.
 */
export async function createAgent(
  component: ConvexAgentComponent,
  definition: ConvexAgentCompatibleDefinition,
  options: CreateAgentOptions = {},
): Promise<Agent> {
  const model = options.model ?? definition.model ?? definition.languageModel
  if (!model) {
    throw new Error('createAgent() requires a model for prompt definitions or unbound Crux agents.')
  }

  const inferredTools = definition.tools ? convexTools(definition.tools) : {}
  const tools = {
    ...inferredTools,
    ...wrapToolRecord(options.tools),
  }

  const resolved = await resolveAiAgent(
    definition as Parameters<typeof resolveAiAgent>[0],
    {
      model: model as never,
      input: options.input as never,
      tokenBudget: options.tokenBudget,
      tools: Object.keys(tools),
    } as Parameters<typeof resolveAiAgent>[1],
  )

  return new Agent(component, {
    name: options.name ?? definition.name ?? definition.id ?? 'Crux Agent',
    languageModel: resolved.model as never,
    instructions: resolved.instructions,
    tools,
  })
}

export interface ConvexAgentCompatibleDefinition {
  /** Stable id used as the fallback agent name. */
  readonly id?: string
  /** Public agent name. */
  readonly name?: string
  /** Legacy Crux model field. */
  readonly model?: unknown
  /** Convex Agent-compatible model field. */
  readonly languageModel?: unknown
  /** Tools inferred and converted into Convex Agent tools. */
  readonly tools?: AnyToolSet
}
