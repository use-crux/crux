import type { FunctionResponsePart } from '@google/genai'
import type { ToolContentPart, ToolModelOutput } from '@use-crux/core'
import { renderToolContentPartAsText } from '@use-crux/core/adapter'

/**
 * Map a Crux tool model output to a Google `functionResponse.response` object.
 *
 * Google expects a structured response payload rather than a string, so each
 * model-output variant gets a deterministic field: `output` for successful
 * text/json/content, `error` for error variants, and `denied`/`reason` for a
 * refused execution. Rich `content` collapses to joined text — the binary
 * payloads ride alongside as inline-data `parts` (see
 * {@link googleFunctionResponseParts}).
 *
 * @param modelOutput - Shaped tool output, when present.
 * @param fallback - Plain-text rendering used when no model output exists.
 * @returns The Google `functionResponse.response` payload.
 */
export function googleToolResponse(
  modelOutput: ToolModelOutput | undefined,
  fallback: string,
): Record<string, unknown> {
  if (!modelOutput) return { output: fallback }

  switch (modelOutput.type) {
    case 'text':
    case 'json':
      return { output: modelOutput.value }
    case 'execution-denied':
      return {
        denied: true,
        reason: modelOutput.reason ?? 'Tool execution denied.',
      }
    case 'error-text':
    case 'error-json':
      return { error: modelOutput.value }
    case 'content':
      return {
        output: modelOutput.value.map(renderToolContentPartAsText).join('\n'),
      }
  }
}

/**
 * Extract Google inline-data parts from rich tool content.
 *
 * Only binary parts (media, image data, file data) become `inlineData`; textual
 * parts are already represented in {@link googleToolResponse}'s `output` string.
 *
 * @param parts - Rich tool content parts.
 * @returns Google `functionResponse.parts`, possibly empty.
 */
export function googleFunctionResponseParts(parts: readonly ToolContentPart[]): FunctionResponsePart[] {
  return parts.flatMap((part): FunctionResponsePart[] => {
    switch (part.type) {
      case 'media':
      case 'image-data':
        return [{ inlineData: { data: part.data, mimeType: part.mediaType } }]
      case 'file-data':
        return [
          {
            inlineData: {
              data: part.data,
              mimeType: part.mediaType,
              ...(part.filename ? { displayName: part.filename } : {}),
            },
          },
        ]
      default:
        return []
    }
  })
}

/** Serialize a decoded Google `functionResponse.response` back to canonical content text. */
export function googleFunctionResponseContent(value: unknown): string {
  const json = JSON.stringify(value ?? {})
  return json ?? String(value)
}
