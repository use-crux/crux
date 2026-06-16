/**
 * Shared AI SDK result normalization.
 *
 * The AI SDK returns rich provider-specific result objects. Crux core only
 * needs a stable `AdapterResponse` projection for policy, replay, tracing,
 * and retry loops, so that projection lives here instead of inside the
 * executor implementation.
 *
 * @internal
 * @module
 */

import type { AdapterResponse } from '@crux/core/adapter'
import { normalizeUsage, type SdkUsageLike } from './meta'

/** Structural shape of an AI SDK result that can be projected for core. */
export interface SdkResponseLike {
  text?: string
  toolCalls?: Array<{ toolCallId: string; toolName: string; input?: unknown; args?: unknown }>
  usage?: SdkUsageLike
  totalUsage?: SdkUsageLike
  finishReason?: string
  response?: { id?: string; modelId?: string }
}

/** Normalize an AI SDK result into core's provider-agnostic response shape. */
export function extractResponse(result: SdkResponseLike): AdapterResponse {
  return {
    text: result.text ?? '',
    toolCalls:
      result.toolCalls && result.toolCalls.length > 0
        ? result.toolCalls.map((tc) => ({ id: tc.toolCallId, name: tc.toolName, args: tc.input ?? tc.args }))
        : undefined,
    usage: normalizeUsage(result.totalUsage ?? result.usage),
    finishReason: result.finishReason,
    responseId: result.response?.id,
    actualModelId: result.response?.modelId,
  }
}
