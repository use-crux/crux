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
import type { AdapterExecutionGenerateArgs, AdapterExecutionGenerateResult, SdkLoopDialect } from './types'
import { appendCorrectiveExchange, appendCorrectiveMessages } from './messages'
import { buildTraceMeta } from './metadata'

/** Inputs shared by the SDK-loop structured retry helper. */
interface GenerateSdkStructuredContext<TClient, TModel, TRawResponse, TRawStream> {
  /** Normalized SDK-loop dialect for one bound SDK client. */
  readonly dialect: SdkLoopDialect<TClient, TModel, TRawResponse, TRawStream>
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
export async function generateSdkStructured<TClient, TModel, TRawResponse, TRawStream>(
  ctx: GenerateSdkStructuredContext<TClient, TModel, TRawResponse, TRawStream>,
): Promise<AdapterExecutionGenerateResult<TRawResponse>> {
  const { dialect, args, request, schema, safety, retryId, promptId, describeCall } = ctx
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
      dialect.attemptStructured(dialect.client, attemptRequest),
    )

    if (attempt.status === 'ok') {
      let steps = 1 + attempts
      let finalText = attempt.response.text
      let finalObject = attempt.object
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
            dialect.attemptStructured(dialect.client, regenRequest),
          )
          steps++
          if (regen.status === 'ok') {
            finalText = regen.response.text
            finalObject = regen.object
            return { text: regen.response.text, parsed: regen.object }
          }
          return { text: regen.rawText, parsed: undefined }
        },
        { messages: currentMessages },
      )
      if (finalOutput.text !== finalText) finalText = finalOutput.text

      const resultMessages: Message[] = [
        ...(currentMessages.length > 0
          ? currentMessages
          : currentPrompt
            ? [{ role: 'user' as const, content: currentPrompt }]
            : []),
        { role: 'assistant' as const, content: finalText },
      ]

      return {
        raw: attempt.raw,
        text: finalText,
        object: finalObject,
        _meta: buildTraceMeta({ response: { ...attempt.response, text: finalText } }),
        steps,
        messages: resultMessages,
      }
    }

    if (attempts < maxRetries) {
      attempts++
      validationRetry?.onRetry?.(attempts, attempt.error)
      getRuntime().instrumentationHooks?.onValidationRetryAttempt?.({
        retryId,
        attemptNumber: attempts,
        maxAttempts: maxRetries,
        error: attempt.error.message,
        rawOutput: attempt.rawText.slice(0, 500),
        repairAttempted: true,
        repairSucceeded: false,
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

    getRuntime().instrumentationHooks?.onValidationRetryExhausted?.({
      retryId,
      totalAttempts: attempts,
      lastError: attempt.error.message,
      promptId: promptId ?? 'unknown',
    })
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
