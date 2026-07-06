/**
 * Structured-output execution for SDK-loop adapters.
 *
 * SDK executors perform exactly one structured attempt at a time. This module
 * owns the Crux corrective-retry loop around those attempts so schema failure,
 * instrumentation hooks, exhaustion errors, output safety, and result shaping
 * stay identical across SDK-loop providers.
 *
 * @internal
 * @module
 */

import type { z } from 'zod'
import type { Message } from '../../generation/messages'
import { getRuntime } from '../../runtime/runtime'
import type { Safety } from '../../safety/session'
import { ValidationExhaustedError } from '../../generation/validation-retry'
import type { ExecutorRequest } from '../executor-types'
import { interceptGeneration, type InterceptedGeneration } from '../interception'
import { formatValidationFeedback } from '../policy/validation-retry'
import type { ResultStepFacts } from '../result-accumulator'
import type { AdapterExecutionGenerateArgs, AdapterExecutionGenerateResult, SdkLoopDialect } from './types'
import { appendCorrectiveExchange, appendCorrectiveMessages } from './messages'
import { buildTraceMeta } from './metadata'
import { finalizeSdkResultEnvelope, sdkResponseFacts } from './sdk-result-envelope'

/** Inputs shared by the SDK-loop structured retry helper. */
interface GenerateSdkStructuredContext<TModel, TRawResponse, TRawStream> {
  /** Normalized SDK-loop dialect for one bound SDK client. */
  readonly dialect: SdkLoopDialect<TModel, TRawResponse, TRawStream>
  /** Original prepared execution arguments, including retry hooks. */
  readonly args: AdapterExecutionGenerateArgs<TModel, Record<string, unknown>>
  /** Fully prepared executor request for the current model attempt. */
  readonly request: ExecutorRequest<TModel>
  /** Zod schema that the structured output must satisfy. */
  readonly schema: z.ZodType
  /** Safety session created by the parent SDK-loop execution. */
  readonly safety: Safety
  /** Stable retry id used for validation instrumentation hooks. */
  readonly retryId: string
  /** Prompt id for exhaustion diagnostics. */
  readonly promptId: string | undefined
  /** Produces interception metadata for each SDK structured attempt. */
  readonly describeCall: (kind: 'structured', request: ExecutorRequest<TModel>) => InterceptedGeneration
  /** Step facts collected by the parent SDK-loop execution. */
  readonly stepFacts: ResultStepFacts[]
}

/**
 * Run the SDK structured-output corrective retry loop.
 *
 * Each iteration calls `attemptStructured()` once. Invalid schema output is
 * folded into a corrective exchange until the retry budget is exhausted; valid
 * output is still passed through final-output safety before returning.
 *
 * @param ctx - Structured retry context prepared by `generateSdk()`.
 * @returns The normalized structured generation result.
 */
export async function generateSdkStructured<TModel, TRawResponse, TRawStream>(
  ctx: GenerateSdkStructuredContext<TModel, TRawResponse, TRawStream>,
): Promise<AdapterExecutionGenerateResult<TRawResponse>> {
  const { dialect, args, request, schema, safety, retryId, promptId, describeCall, stepFacts } = ctx
  const validationRetry = args.validationRetry
  const maxRetries = validationRetry?.maxRetries ?? 0
  let attempts = 0
  let currentMessages = request.messages ? [...request.messages] : []
  let currentPrompt = request.prompt

  for (;;) {
    const attemptRequest = {
      ...request,
      prompt: currentPrompt,
      messages: currentMessages,
      schema,
    }
    const attempt = await interceptGeneration(describeCall('structured', attemptRequest), () =>
      dialect.runStructuredAttempt(attemptRequest),
    )

    if (attempt.status === 'ok') {
      let steps = 1 + attempts
      let finalText = attempt.response.text
      let finalObject = attempt.object
      let finalRaw = attempt.raw
      let finalResponse = attempt.response
      const finalOutput = await safety.finalizeOutput(
        { text: finalText, parsed: finalObject },
        async (corrective) => {
          const regenMessages = appendCorrectiveMessages(currentPrompt, currentMessages, finalText, corrective)
          currentPrompt = undefined
          currentMessages = regenMessages
          const regenRequest = {
            ...request,
            prompt: undefined,
            messages: regenMessages,
            schema,
          }
          const regen = await interceptGeneration(describeCall('structured', regenRequest), () =>
            dialect.runStructuredAttempt(regenRequest),
          )
          steps++
          if (regen.status === 'ok') {
            if (stepFacts.length > 0) {
              const previous = stepFacts[stepFacts.length - 1]!
              stepFacts[stepFacts.length - 1] = { ...previous, text: '' }
            }
            finalText = regen.response.text
            finalObject = regen.object
            finalRaw = regen.raw
            finalResponse = regen.response
            stepFacts.push(sdkResponseFacts(regen.response))
            return { text: regen.response.text, parsed: regen.object }
          }
          return { text: regen.rawText, parsed: undefined }
        },
        { messages: currentMessages, schema },
      )
      finalText = finalOutput.text
      finalObject = finalOutput.parsed

      const resultMessages: Message[] = [
        ...(currentMessages.length > 0
          ? currentMessages
          : currentPrompt
            ? [{ role: 'user' as const, content: currentPrompt }]
            : []),
        { role: 'assistant' as const, content: finalText },
      ]

      return finalizeSdkResultEnvelope({
        raw: finalRaw,
        response: finalResponse,
        text: finalText,
        object: finalObject,
        _meta: buildTraceMeta({ response: { ...finalResponse, text: finalText } }),
        messages: resultMessages,
        stepFacts,
        finalStepMode: stepFacts.length < steps ? 'append' : 'replace',
      })
    }

    if (attempts < maxRetries) {
      attempts++
      validationRetry?.onRetry?.(attempts, attempt.error)
      stepFacts.push({
        text: '',
        finishReason: undefined,
        responseId: undefined,
        modelId: undefined,
      })
      currentMessages = appendCorrectiveExchange(
        currentPrompt,
        currentMessages,
        attempt.rawText,
        formatValidationFeedback(attempt.rawText, attempt.error),
      )
      currentPrompt = undefined
      continue
    }

    validationRetry?.onExhausted?.(attempts, attempt.error)
    throw new ValidationExhaustedError({
      lastRawOutput: attempt.rawText,
      zodErrors: attempt.error,
      attempts,
      maxAttempts: maxRetries,
      promptId: promptId ?? 'unknown',
    })
  }
}
