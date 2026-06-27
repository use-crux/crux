import type { LanguageModelV3 } from '@ai-sdk/provider'
import { prompt as definePrompt } from '@use-crux/core'
import type { ContextEntry, ResolveOptions } from '@use-crux/core'
import type { CruxStore } from '@use-crux/core/store'
import type { z } from 'zod'
import { assertConvexCtxPort, createDefaultConvexCruxStore } from '../profile-store'
import { runWithConvexCruxRuntime, type ConvexRuntimeTarget } from '../runtime'
import type { ComponentApi } from '../src/component/_generated/component'
import { afterPreparedAgentCall, readPersistedSkillIds } from './lifecycle-persistence'
import { observeAgentRun } from './lifecycle-observability'
import {
  prepareMessagesFromSnapshot,
  targetFromContextSnapshot,
  withThreadCallArgs,
  withThreadContextOptions,
  wrapCruxConvexThread,
} from './lifecycle-thread'
import { toDriverToolRecord } from './lifecycle-tools'
import type {
  AgentThreadRequest,
  AgentTurnRequest,
  AnyConvexPrompt,
  AnyConvexPromptConfig,
  ConvexAgentCallArgs,
  PreparedAgentCall,
  ProfileBackedAgentLifecycle,
  ProfileBackedAgentLifecycleConfig,
} from './lifecycle-types'
import type { ConvexAgentPassthroughOptions } from './driver'
import { isFinishCallback, toInputRecord } from './lifecycle-utils'

/** Create the internal lifecycle used by the public `convexAgent()` facade. */
export function createProfileBackedAgentLifecycle<TPrompt extends AnyConvexPrompt>(
  config: ProfileBackedAgentLifecycleConfig<TPrompt>,
): ProfileBackedAgentLifecycle<TPrompt> {
  const name = config.name ?? config.prompt.id ?? 'Crux Convex Agent'
  const languageModel = config.languageModel ?? config.model
  const agentOptions = agentOptionsFromConfig(config)

  if (!languageModel) {
    throw new Error('convexAgent() requires `languageModel` (or the legacy `model` alias).')
  }
  const resolvedLanguageModel: LanguageModelV3 = languageModel

  async function withPreparedRuntime<R>(ctx: unknown, target: ConvexRuntimeTarget, fn: () => Promise<R>): Promise<R> {
    const store = config.store ? await config.store(ctx) : await defaultConvexAgentStore(config.components.crux, ctx)
    return await runWithConvexCruxRuntime(
      {
        ctx,
        component: config.components.crux,
        store,
        target,
        namespace: config.namespace,
      },
      fn,
    )
  }

  async function prepareAgentCall(
    ctx: unknown,
    target: ConvexRuntimeTarget,
    args: ConvexAgentCallArgs<TPrompt>,
    messages?: Parameters<NonNullable<ProfileBackedAgentLifecycleConfig<TPrompt>['prepare']>>[0]['messages'],
  ): Promise<PreparedAgentCall> {
    const prepared = config.prepare
      ? await config.prepare({
          ctx,
          target,
          args,
          input: args.input,
          messages,
        })
      : undefined
    const input = await inputWithPersistedSkills(toInputRecord(prepared?.input ?? args.input))
    const activePrompt = promptWithRuntimeUse(prepared?.prompt ?? config.prompt, prepared?.use)
    const resolved = await resolvePreparedPrompt(
      activePrompt,
      input,
      prepared?.tokenBudget ?? args.tokenBudget ?? config.tokenBudget,
    )
    const convexToolSet = {
      ...toDriverToolRecord(config.driver, resolved.tools as Record<string, unknown> | undefined),
      ...toDriverToolRecord(config.driver, config.tools),
      ...toDriverToolRecord(config.driver, prepared?.tools),
    }
    const { input: _input, tokenBudget: _tokenBudget, ...rest } = args
    void _input
    void _tokenBudget

    return {
      session: config.driver.create({
        component: config.components.agent,
        options: agentOptions,
        name,
        languageModel: resolvedLanguageModel,
        instructions: resolved.system ?? '',
        tools: convexToolSet,
      }),
      resolved,
      convexTools: convexToolSet,
      input,
      captureMessages: prepared?.captureMessages,
      callArgs: {
        ...rest,
        ...(resolved.system ? { system: resolved.system } : {}),
        ...(resolved.prompt ? { prompt: resolved.prompt } : {}),
        ...(resolved.messages ? { messages: resolved.messages } : {}),
        tools: convexToolSet,
      },
    }
  }

  return {
    name,
    async resolveOnly(request: AgentTurnRequest<TPrompt>) {
      return await withPreparedRuntime(
        request.ctx,
        request.target,
        async () =>
          await observeAgentRun(name, config.prompt.id, 'resolve', request.target, async (recordPrepared) => {
            const prepared = await prepareAgentCall(request.ctx, request.target, request.args)
            await recordPrepared(prepared)
            return prepared.resolved
          }),
      )
    },
    async invokeText(request: AgentTurnRequest<TPrompt>) {
      return await withPreparedRuntime(
        request.ctx,
        request.target,
        async () =>
          await observeAgentRun(name, config.prompt.id, 'generateText', request.target, async (recordPrepared) => {
            const prepared = await prepareAgentCall(request.ctx, request.target, request.args)
            await recordPrepared(prepared)
            const result = await prepared.session.generateText(
              request.ctx,
              request.target,
              prepared.callArgs,
              request.options,
            )
            await afterPreparedAgentCall({
              resolved: prepared.resolved,
              input: prepared.input,
              result,
              captureMessages: prepared.captureMessages,
            })
            return result
          }),
      )
    },
    async invokeStream(request: AgentTurnRequest<TPrompt>) {
      return await withPreparedRuntime(
        request.ctx,
        request.target,
        async () =>
          await observeAgentRun(name, config.prompt.id, 'streamText', request.target, async (recordPrepared) => {
            const prepared = await prepareAgentCall(request.ctx, request.target, request.args)
            await recordPrepared(prepared)
            const userOnFinish = isFinishCallback(prepared.callArgs.onFinish) ? prepared.callArgs.onFinish : undefined
            prepared.callArgs.onFinish = async (result: unknown) => {
              await afterPreparedAgentCall({
                resolved: prepared.resolved,
                input: prepared.input,
                result,
                captureMessages: prepared.captureMessages,
              })
              if (userOnFinish) return await userOnFinish(result)
              return undefined
            }
            return await prepared.session.streamText(request.ctx, request.target, prepared.callArgs, request.options)
          }),
      )
    },
    async continueThread(request: AgentThreadRequest<TPrompt>) {
      const session = config.driver.create({
        component: config.components.agent,
        options: agentOptions,
        name,
        languageModel: resolvedLanguageModel,
        instructions: '',
        tools: {},
      })
      const { thread } = await session.continueThread(request.ctx, {
        threadId: request.target.threadId,
        userId: request.target.userId ?? null,
      })
      return {
        thread: wrapCruxConvexThread(thread, {
          run: async (callArgs, options, fn) => {
            const snapshot = await config.driver.fetchContext({
              ctx: request.ctx,
              component: config.components.agent,
              agentName: name,
              agentOptions,
              target: request.target,
              callArgs,
              options,
            })
            const preparedTarget = targetFromContextSnapshot(request.target, snapshot)
            return await withPreparedRuntime(
              request.ctx,
              preparedTarget,
              async () =>
                await observeAgentRun(name, config.prompt.id, fn.operation, preparedTarget, async (recordPrepared) => {
                  const prepared = withThreadCallArgs(
                    await prepareAgentCall(
                      request.ctx,
                      preparedTarget,
                      request.args,
                      prepareMessagesFromSnapshot(snapshot),
                    ),
                    callArgs,
                  )
                  await recordPrepared(prepared, preparedTarget)
                  return await fn({
                    ctx: request.ctx,
                    target: preparedTarget,
                    prepared,
                    options: withThreadContextOptions(options, snapshot, prepared.callArgs),
                  })
                }),
            )
          },
        }),
      }
    },
  }
}

function agentOptionsFromConfig<TPrompt extends AnyConvexPrompt>(
  config: ProfileBackedAgentLifecycleConfig<TPrompt>,
): ConvexAgentPassthroughOptions {
  const {
    components: _components,
    driver: _driver,
    languageModel: _languageModel,
    model: _model,
    namespace: _namespace,
    name: _name,
    prepare: _prepare,
    prompt: _prompt,
    store: _store,
    tokenBudget: _tokenBudget,
    tools: _tools,
    ...agentOptions
  } = config
  void _components
  void _driver
  void _languageModel
  void _model
  void _namespace
  void _name
  void _prepare
  void _prompt
  void _store
  void _tokenBudget
  void _tools
  return agentOptions
}

async function inputWithPersistedSkills(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const activeSkillIds = await readPersistedSkillIds()
  if (activeSkillIds.length === 0) return input
  return {
    ...input,
    _crux_activeSkills: activeSkillIds,
  }
}

function promptWithRuntimeUse<TPrompt extends AnyConvexPrompt>(
  basePrompt: TPrompt,
  runtimeUse: readonly ContextEntry[] | undefined,
): AnyConvexPrompt {
  if (!runtimeUse || runtimeUse.length === 0) return basePrompt
  const baseConfig = basePrompt.config as AnyConvexPromptConfig
  return definePrompt({
    ...baseConfig,
    use: [...basePrompt.contexts, ...runtimeUse],
  })
}

async function resolvePreparedPrompt(
  activePrompt: AnyConvexPrompt,
  input: Record<string, unknown>,
  tokenBudget: number | undefined,
) {
  return await activePrompt.resolve({
    input,
    tokenBudget,
  } as unknown as ResolveOptions<z.ZodType, readonly ContextEntry[]>)
}

async function defaultConvexAgentStore(component: ComponentApi, ctx: unknown): Promise<CruxStore> {
  if (!component) {
    throw new Error('convexAgent() requires components.crux or a custom store to bind Crux runtime state.')
  }
  assertConvexCtxPort(ctx)
  return createDefaultConvexCruxStore(ctx, { component })
}
