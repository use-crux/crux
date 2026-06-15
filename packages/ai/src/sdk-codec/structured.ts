import type { LanguageModel } from 'ai'
import { repairJsonText } from '@crux/core'
import type { StructuredRequest } from '@crux/core/adapter'
import type { SdkGateway } from '../gateway'
import { extractRawTextFromError, extractZodError, isObjectGenerationError } from '../meta'
import { sanitizeSchemaForProvider } from '../provider-profile'
import { extractResponse } from '../result-shape'
import { buildBaseArgs } from './request-args'
import type { AiSdkStructuredPlan, SdkLoopResultLike } from './types'

type StructuredArgs = Parameters<SdkGateway['generateObject']>[0]

/**
 * Plan one AI SDK `generateObject()` attempt.
 *
 * Core owns validation retry policy. This codec owns the SDK-specific pieces
 * for a single attempt: provider schema sanitation, cheap JSON text repair,
 * raw result projection, and validation/parse errors returned as values.
 *
 * @internal
 */
export async function createStructuredCallPlan(
  request: StructuredRequest<LanguageModel>,
): Promise<AiSdkStructuredPlan> {
  const args = await buildStructuredArgs(request)

  return {
    method: 'generateObject',
    args,
    decode(raw) {
      const result = raw as SdkLoopResultLike
      return {
        status: 'ok',
        raw: result,
        response: extractResponse(result),
        object: result.object,
      }
    },
    async decodeError(error) {
      if (!isObjectGenerationError(error)) return undefined
      return {
        status: 'invalid',
        rawText: extractRawTextFromError(error),
        error: await extractZodError(error),
      }
    },
  }
}

async function buildStructuredArgs(request: StructuredRequest<LanguageModel>): Promise<StructuredArgs> {
  const args = buildBaseArgs(request, { includeTools: false })
  args.schema = await sanitizeSchemaForProvider(request.schema, request.modelInfo)
  args.experimental_repairText = async ({ text }: { readonly text: string }) => {
    const repaired = repairJsonText(text)
    return repaired !== text ? repaired : null
  }

  return args as StructuredArgs
}
