import type { LanguageModelV3 } from '@ai-sdk/provider'
import { prompt as definePrompt } from '@use-crux/core'
import type { ContextEntry, ResolveOptions } from '@use-crux/core'
import type { RecordStore, Storage } from '@use-crux/core/storage'
import type { z } from 'zod'
import { runWithConvexCruxRuntime, type ConvexRuntimeTarget } from '../runtime'
import { afterPreparedAgentCall, readPersistedSkillIds } from './lifecycle-persistence'
import { observeAgentRun } from './lifecycle-observability'
import { defaultConvexAgentStorage } from './lifecycle-store'
import { agentOptionsFromConfig } from './lifecycle-config'
import {
  prepareMessagesFromSnapshot,
  targetFromContextSnapshot,
  convexCallArgsFromTurnArgs,
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
  ConvexAgentOperation,
  PreparedAgentCall,
  ProfileBackedAgentLifecycle,
  ProfileBackedAgentLifecycleConfig,
} from './lifecycle-types'
import type { ConvexGenerateObjectArgs, ConvexStreamObjectArgs } from './convex-agent-method-types'
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
    const storage = config.storage
      ? normalizeStorage(await config.storage(ctx))
      : await defaultConvexAgentStorage(config.components.crux, ctx)
    return await runWithConvexCruxRuntime(
      {
        ctx,
        component: config.components.crux,
        storage,
        records: storage.records,
        target,
        namespace: config.namespace,
      },
      fn,
    )
  }

  async function prepareAgentCall(
    ctx: unknown,
    target: ConvexRuntimeTarget,
    args: ConvexAgentCallArgs<TPrompt, object>,
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
      persistence: config.persistence,
      captureMessages: prepared?.captureMessages,
      callArgs: {
        ...rest,
        ...(resolved.system ? { system: resolved.system } : {}),
        ...(resolved.prompt ? { prompt: resolved.prompt } : {}),
        ...(resolved.messages ? { messages: resolved.messages } : {}),
        ...(resolved.schema ? { schema: resolved.schema } : {}),
        tools: convexToolSet,
      },
    }
  }

  async function invokePreparedTurn(
    request: AgentTurnRequest<TPrompt, object>,
    operation: Exclude<ConvexAgentOperation, 'resolve'>,
    mode: 'afterCall' | 'onFinish',
    call: (prepared: PreparedAgentCall) => Promise<unknown>,
  ): Promise<unknown> {
    return await withPreparedRuntime(
      request.ctx,
      request.target,
      async () =>
        await observeAgentRun(
          name,
          config.prompt.id,
          operation,
          request.target,
          config.observe,
          async (recordPrepared) => {
            const prepared = await prepareAgentCall(request.ctx, request.target, request.args)
            await recordPrepared(prepared)
            if (mode === 'onFinish') patchOnFinishPersistence(prepared)
            const result = await call(prepared)
            if (mode === 'afterCall') await persistPreparedResult(prepared, result)
            return result
          },
        ),
    )
  }

  function patchOnFinishPersistence(prepared: PreparedAgentCall): void {
    const userOnFinish = isFinishCallback(prepared.callArgs.onFinish) ? prepared.callArgs.onFinish : undefined
    prepared.callArgs.onFinish = async (result: unknown) => {
      await persistPreparedResult(prepared, result)
      if (userOnFinish) return await userOnFinish(result)
      return undefined
    }
  }

  async function persistPreparedResult(prepared: PreparedAgentCall, result: unknown): Promise<void> {
    await afterPreparedAgentCall({
      resolved: prepared.resolved,
      input: prepared.input,
      result,
      persistence: prepared.persistence,
      captureMessages: prepared.captureMessages,
    })
  }

  return {
    name,
    async resolveOnly(request: AgentTurnRequest<TPrompt>) {
      return await withPreparedRuntime(
        request.ctx,
        request.target,
        async () =>
          await observeAgentRun(
            name,
            config.prompt.id,
            'resolve',
            request.target,
            config.observe,
            async (recordPrepared) => {
              const prepared = await prepareAgentCall(request.ctx, request.target, request.args)
              await recordPrepared(prepared)
              return prepared.resolved
            },
          ),
      )
    },
    async invokeText(request: AgentTurnRequest<TPrompt>) {
      return await invokePreparedTurn(request, 'generateText', 'afterCall', async (prepared) =>
        await prepared.session.generateText(request.ctx, request.target, prepared.callArgs, request.options),
      )
    },
    async invokeStream(request: AgentTurnRequest<TPrompt>) {
      return await invokePreparedTurn(request, 'streamText', 'onFinish', async (prepared) =>
        await prepared.session.streamText(request.ctx, request.target, prepared.callArgs, request.options),
      )
    },
    async invokeObject(request: AgentTurnRequest<TPrompt, ConvexGenerateObjectArgs>) {
      return await invokePreparedTurn(request, 'generateObject', 'afterCall', async (prepared) =>
        await prepared.session.generateObject(request.ctx, request.target, prepared.callArgs, request.options),
      )
    },
    async invokeObjectStream(request: AgentTurnRequest<TPrompt, ConvexStreamObjectArgs>) {
      return await invokePreparedTurn(request, 'streamObject', 'onFinish', async (prepared) =>
        await prepared.session.streamObject(request.ctx, request.target, prepared.callArgs, request.options),
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
            const convexCallArgs = convexCallArgsFromTurnArgs(callArgs as Record<string, unknown>)
            const snapshot = await config.driver.fetchContext({
              ctx: request.ctx,
              component: config.components.agent,
              agentName: name,
              agentOptions,
              target: request.target,
              callArgs: convexCallArgs,
              options,
            })
            const preparedTarget = targetFromContextSnapshot(request.target, snapshot)
            return await withPreparedRuntime(
              request.ctx,
              preparedTarget,
              async () =>
                await observeAgentRun(
                  name,
                  config.prompt.id,
                  fn.operation,
                  preparedTarget,
                  config.observe,
                  async (recordPrepared) => {
                    const prepared = withThreadCallArgs(
                      await prepareAgentCall(
                        request.ctx,
                        preparedTarget,
                        callArgs as ConvexAgentCallArgs<TPrompt, object>,
                        prepareMessagesFromSnapshot(snapshot),
                      ),
                      convexCallArgs,
                    )
                    await recordPrepared(prepared, preparedTarget)
                    return await fn({
                      ctx: request.ctx,
                      target: preparedTarget,
                      prepared,
                      options: withThreadContextOptions(options, snapshot, prepared.callArgs),
                    })
                  },
                ),
            )
          },
        }),
      }
    },
  }
}

function normalizeStorage(value: Storage | RecordStore): Storage {
  return 'records' in value ? value : { records: value }
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
