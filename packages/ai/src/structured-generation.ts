/**
 * AI SDK structured-output single-attempt mechanics.
 *
 * Core owns structured-output policy for SDK-loop adapters: validation retry,
 * corrective feedback, exhaustion errors, safety, interception, and result
 * shaping. This module owns the one AI SDK-specific operation core cannot
 * perform: exactly one `generateObject()` attempt with provider schema quirks,
 * cheap JSON repair, and SDK validation errors translated into the
 * `StructuredAttempt` contract.
 *
 * @internal
 * @module
 */

import type { LanguageModel } from 'ai'
import { repairJsonText } from '@crux/core'
import type { StructuredAttempt, StructuredRequest } from '@crux/core/adapter'
import type { GenerateObjectFn } from '@crux/core/compaction'
import { isCascade, isRouter, resolveModel } from '@crux/core/routing'
import type { SdkGateway } from './gateway'
import type { SdkLoopResultLike } from './executor'
import { extractRawTextFromError, extractZodError, isObjectGenerationError } from './meta'
import { toModelMessages } from './messages'
import { buildSystemArg, extractModelInfo, sanitizeSchemaForProvider } from './provider-profile'
import { extractResponse } from './result-shape'

/** The gateway surface required for one AI SDK structured-output attempt. */
export type StructuredGateway = Pick<SdkGateway, 'generateObject'>

type StructuredArgs = Parameters<StructuredGateway['generateObject']>[0]

interface GenerateObjectOptions<T> {
  readonly model: unknown
  readonly system?: string
  readonly prompt: string
  readonly schema: import('zod').ZodType<T>
}

interface StructuredObjectResult<T> {
  readonly object: T
}

/**
 * Perform exactly one AI SDK `generateObject()` attempt.
 *
 * Validation and parse failures are returned as `status: 'invalid'` so core
 * can decide whether and how to retry. Provider, transport, and other runtime
 * failures continue to throw unchanged.
 */
export async function attemptStructuredGeneration(
  gateway: StructuredGateway,
  request: StructuredRequest<LanguageModel>,
): Promise<StructuredAttempt<SdkLoopResultLike>> {
  const args = await buildStructuredArgs(request)

  try {
    const result = (await gateway.generateObject(args)) as SdkLoopResultLike
    return {
      status: 'ok',
      raw: result,
      response: extractResponse(result),
      object: result.object,
    }
  } catch (error) {
    if (!isObjectGenerationError(error)) throw error
    return {
      status: 'invalid',
      rawText: extractRawTextFromError(error),
      error: await extractZodError(error),
    }
  }
}

/**
 * Create the standalone `GenerateObjectFn` used by Crux primitives such as
 * judges and extraction helpers.
 *
 * The helper shares the same schema sanitation and repair mechanics as prompt
 * structured generation, while keeping the public `GenerateObjectFn` shape:
 * callers receive `{ object }`, not a `StructuredAttempt`.
 */
export function createStructuredGenerateObjectFn(gateway: StructuredGateway): GenerateObjectFn {
  return async <T>(options: GenerateObjectOptions<T>): Promise<StructuredObjectResult<T>> => {
    const run = async (model: LanguageModel): Promise<StructuredObjectResult<T>> => {
      const attempt = await attemptStructuredGeneration(gateway, requestFromGenerateObjectOptions(model, options))
      if (attempt.status === 'invalid') throw attempt.error
      return { object: attempt.object as T }
    }

    if (isRouter(options.model) || isCascade(options.model)) {
      const resolved = await resolveModel<LanguageModel, StructuredObjectResult<T>>(
        options.model as unknown as LanguageModel,
        { prompt: options.prompt },
        run,
        modelLabel,
      )
      return { object: resolved.object }
    }

    return run(options.model as LanguageModel)
  }
}

async function buildStructuredArgs(request: StructuredRequest<LanguageModel>): Promise<StructuredArgs> {
  const args: Record<string, unknown> = {
    model: request.model,
    ...request.settings,
  }

  const systemArg = buildSystemArg(request.systemBlocks, request.system, request.modelInfo)
  if (systemArg !== undefined) args.system = systemArg

  if (request.messages && request.messages.length > 0) {
    args.messages = toModelMessages(request.messages)
  } else if (request.prompt) {
    args.prompt = request.prompt
  }

  if (request.abortSignal) args.abortSignal = request.abortSignal
  args.schema = await sanitizeSchemaForProvider(request.schema, request.modelInfo)
  args.experimental_repairText = async ({ text }: { readonly text: string }) => {
    const repaired = repairJsonText(text)
    return repaired !== text ? repaired : null
  }

  return args as StructuredArgs
}

function requestFromGenerateObjectOptions<T>(
  model: LanguageModel,
  options: GenerateObjectOptions<T>,
): StructuredRequest<LanguageModel> {
  return {
    model,
    modelInfo: extractModelInfo(model),
    system: options.system,
    systemBlocks: undefined,
    prompt: options.prompt,
    messages: undefined,
    settings: {},
    tools: undefined,
    activeTools: undefined,
    maxSteps: 1,
    observer: undefined,
    abortSignal: undefined,
    extra: undefined,
    schema: options.schema,
  }
}

function modelLabel(model: LanguageModel): string {
  const info = extractModelInfo(model)
  return info.modelId || info.provider
}
