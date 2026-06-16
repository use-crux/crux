/**
 * SDK-loop non-streaming execution.
 *
 * This module wraps loop-owning SDKs such as the Vercel AI SDK. The SDK drives
 * the step loop, while Crux prepares the request, merges tools, steers skill
 * loads through `StepObserver`, applies safety/retry policy, and captures the
 * completed turn.
 *
 * @internal
 * @module
 */

import type { Message } from '../../messages'
import { createSafety } from '../../safety/session'
import type { Safety } from '../../safety/session'
import { orchestrateGenerate } from '../../orchestrate'
import type { ExecutorOutcome, ExecutorRequest, StepDirective, StepObserver } from '../executor-types'
import { describeTools, interceptGeneration, type InterceptedGeneration } from '../interception'
import { createToolLifecycle } from '../tool/session'
import type { AdapterExecutionGenerateArgs, AdapterExecutionGenerateResult, SdkLoopDialect } from './types'
import { initialMessageState } from './messages'
import { buildTraceMeta } from './metadata'
import { buildResolveOpts, createTimeoutSignal, DEFAULT_MAX_STEPS, inspectForDevtools, mergeDirectives } from './shared'
import { generateSdkStructured } from './generate-sdk-structured'

/** Regeneration is deliberately unavailable after tool-approval suspension. */
const unreachableRegenerate = (): Promise<never> => {
  throw new Error('regenerate is unreachable for suspended results')
}

/**
 * Execute one prompt through an SDK-owned loop.
 *
 * Routing has already selected a concrete model before this function runs.
 * The SDK receives a fully prepared `ExecutorRequest`; Crux owns everything
 * around that request, including timeout signals, tool approval resume,
 * safety, validation retry, trace metadata, and memory capture.
 *
 * @param dialect - Normalized SDK-loop dialect for one bound SDK client.
 * @param args - Prepared execution arguments from `executorAdapter()`.
 * @returns The normalized non-streaming executor result.
 */
export async function generateSdk<TClient, TModel, TRawResponse, TRawStream>(
  dialect: SdkLoopDialect<TClient, TModel, TRawResponse, TRawStream>,
  args: AdapterExecutionGenerateArgs<TModel, Record<string, unknown>>,
): Promise<AdapterExecutionGenerateResult<TRawResponse>> {
  const prompt = args.prompt
  const modelInfo = dialect.describeModel(args.model)
  const resolveOpts = buildResolveOpts({
    input: args.input,
    provider: modelInfo.provider,
    modelId: modelInfo.modelId,
    tokenBudget: args.tokenBudget,
    settings: args.settings,
  })
  const resolved = await prompt.resolve(resolveOpts)
  const mappedSettings = dialect.mapSettings(resolved.settings, modelInfo)
  const lifecycle = createToolLifecycle({
    regime: 'sdk',
    resolved,
    call: { tools: args.tools, toolMiddleware: args.toolMiddleware },
    promptId: prompt.id,
    input: args.input ?? {},
    reresolve: () => prompt.resolve(resolveOpts),
  })

  let { messages, promptText } = initialMessageState(resolved, args.messages)
  messages = (await lifecycle.resume(messages)).messages
  let currentSystem = resolved.system
  let currentSystemBlocks = resolved.systemBlocks
  const maxSteps = args.maxSteps ?? DEFAULT_MAX_STEPS
  const retryId = args.validationRetry ? `vr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` : ''
  const safety: Safety = createSafety({
    call: {
      constraints: args.constraints,
      guardrails: args.guardrails,
      constraintMaxRetries: args.constraintMaxRetries,
    },
    resolved: { constraints: resolved.constraints, guardrails: resolved.guardrails, metadata: resolved.metadata },
    promptId: prompt.id,
    model: modelInfo.modelId,
    traceId: retryId || undefined,
    systemPrompt: resolved.system,
  })

  const loopObserver: StepObserver = {
    onStepFinish: async (step) => {
      const amendment = await lifecycle.applySkillLoads(step.toolCalls)
      let factoryDirective: StepDirective = { kind: 'continue' }
      if (amendment) {
        currentSystem = amendment.system
        currentSystemBlocks = amendment.systemBlocks
        factoryDirective = {
          kind: 'amend',
          ...(amendment.system !== undefined ? { system: amendment.system } : {}),
          ...(amendment.systemBlocks !== undefined ? { systemBlocks: amendment.systemBlocks } : {}),
          ...(lifecycle.tools !== undefined ? { tools: lifecycle.tools } : {}),
          refundStep: true,
        }
      }
      const callerDirective = await args.observer?.onStepFinish(step)
      return mergeDirectives(factoryDirective, callerDirective)
    },
  }

  const buildRequest = (signal: AbortSignal | undefined): ExecutorRequest<TModel> => ({
    model: args.model,
    modelInfo,
    system: currentSystem,
    systemBlocks: currentSystemBlocks,
    prompt: promptText,
    messages,
    settings: mappedSettings,
    tools: lifecycle.tools,
    activeTools: args.activeTools,
    maxSteps,
    observer: loopObserver,
    abortSignal: signal,
    extra: args.extra,
  })

  const generated = await orchestrateGenerate<Record<string, unknown>, AdapterExecutionGenerateResult<TRawResponse>>(
    {
      promptId: prompt.id,
      promptConfig: prompt.config ?? ({} as NonNullable<typeof prompt.config>),
      preparedArgs: {
        model: modelInfo.modelId,
        system: currentSystem,
        systemBlocks: currentSystemBlocks,
        prompt: promptText,
        messages,
        settings: mappedSettings,
        schema: resolved.schema,
        tools: lifecycle.tools,
        input: args.input ?? {},
        ...(await inspectForDevtools(prompt, resolveOpts, lifecycle.tools)),
      },
      model: args.model,
      input: args.input ?? {},
      provider: modelInfo.provider || dialect.id,
      resolved,
      outputMode: resolved.schema ? 'object' : 'text',
      timeoutMs: args.timeoutMs,
    },
    async () => {
      const { signal, dispose } = createTimeoutSignal(args.timeoutMs)
      try {
        const guardedInput = await safety.guardInput({ messages, prompt: promptText })
        messages = [...guardedInput.messages]
        promptText = guardedInput.prompt
        const request = buildRequest(signal)
        const result = resolved.schema
          ? await generateSdkStructured({
              dialect,
              args,
              request,
              schema: resolved.schema,
              safety,
              retryId,
              promptId: prompt.id,
              describeCall,
            })
          : await generateLoop(request)
        result._meta = safety.stamp(result._meta)
        return result
      } finally {
        dispose()
      }
    },
  )

  await lifecycle.captureTurn({
    messages: generated.messages,
    assistantText: generated.text,
    toolCalls: generated._meta.toolCalls,
  })

  return generated

  /** Describe a concrete SDK call for interception, middleware, and devtools. */
  function describeCall(kind: 'loop' | 'structured', request: ExecutorRequest<TModel>): InterceptedGeneration {
    return {
      kind,
      promptId: prompt.id,
      modelInfo,
      system: request.system,
      prompt: request.prompt,
      messages: request.messages,
      settings: request.settings,
      tools: describeTools(request.tools),
    }
  }

  /** Run the SDK text/tool loop and apply final-output safety regeneration. */
  async function generateLoop(request: ExecutorRequest<TModel>): Promise<AdapterExecutionGenerateResult<TRawResponse>> {
    const outcome = await interceptGeneration(describeCall('loop', request), () =>
      dialect.runLoop(dialect.client, request),
    )

    if (outcome.status === 'suspended') {
      const result = buildSuspendedResult(outcome)
      await safety.finalizeOutput({ text: result.text }, unreachableRegenerate, {
        suspended: true,
        messages: result.messages,
      })
      return result
    }

    let steps = outcome.steps
    let finalText = outcome.response.text
    let resultMessages = [...outcome.messages]
    const finalOutput = await safety.finalizeOutput(
      { text: finalText, parsed: undefined },
      async (corrective) => {
        const regenMessages: Message[] = [...resultMessages, ...corrective]
        const regenRequest: ExecutorRequest<TModel> = {
          ...request,
          prompt: undefined,
          messages: regenMessages,
          maxSteps: 1,
          observer: undefined,
        }
        const regen = await interceptGeneration(describeCall('loop', regenRequest), () =>
          dialect.runLoop(dialect.client, regenRequest),
        )
        steps++
        if (regen.status === 'complete') {
          finalText = regen.response.text
          resultMessages = [...regen.messages]
          return { text: regen.response.text, parsed: undefined }
        }
        return { text: finalText, parsed: undefined }
      },
      { messages: resultMessages },
    )
    if (finalOutput.text !== finalText) finalText = finalOutput.text

    return {
      raw: outcome.raw,
      text: finalText,
      _meta: buildTraceMeta({
        response: { ...outcome.response, text: finalText },
        costUsd: outcome.meta.costUsd,
      }),
      steps,
      messages: resultMessages,
    }
  }

  /** Convert an SDK approval suspension into the shared adapter result shape. */
  function buildSuspendedResult(
    outcome: Extract<ExecutorOutcome<TRawResponse>, { status: 'suspended' }>,
  ): AdapterExecutionGenerateResult<TRawResponse> {
    const sealed = lifecycle.suspend(outcome.pendingApprovals, outcome.assistantResponse, outcome.messages)
    return {
      raw: undefined,
      text: outcome.assistantResponse.text,
      _meta: buildTraceMeta({
        response: { ...outcome.assistantResponse, finishReason: 'tool_approval_required' },
      }),
      steps: outcome.steps,
      messages: sealed.messages,
      pendingApprovals: sealed.requests,
    }
  }
}
