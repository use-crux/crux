import type { GenerateContentResponse, GoogleGenAI } from '@google/genai'

/** Create the narrow Google client double used by media boundary tests. */
export function client(
  overrides: Readonly<{
    generateContent?: (request: unknown) => Promise<unknown>
    generateContentStream?: (request: unknown) => Promise<unknown>
  }> = {},
): GoogleGenAI {
  return {
    models: {
      generateContent: overrides.generateContent ?? (async () => response('unused')),
      generateContentStream: overrides.generateContentStream ?? (async () => emptyStream()),
    },
  } as unknown as GoogleGenAI
}

/** Create one deterministic Google response for media boundary tests. */
export function response(
  text: string,
  toolCall?: Readonly<{ id: string; name: string; args: unknown }>,
): GenerateContentResponse {
  return {
    text: text || undefined,
    modelVersion: 'gemini-2.5-flash-actual',
    usageMetadata: {
      promptTokenCount: 2,
      candidatesTokenCount: 3,
      totalTokenCount: 5,
    },
    candidates: [
      {
        content: {
          role: 'model',
          parts: [
            ...(text ? [{ text }] : []),
            ...(toolCall
              ? [
                  {
                    functionCall: {
                      id: toolCall.id,
                      name: toolCall.name,
                      args: isRecord(toolCall.args) ? toolCall.args : { value: toolCall.args },
                    },
                  },
                ]
              : []),
          ],
        },
        finishReason: toolCall ? 'FUNCTION_CALL' : 'STOP',
      },
    ],
  } as GenerateContentResponse
}

/** Create an empty native stream for stream-request payload assertions. */
export async function* emptyStream(): AsyncIterable<GenerateContentResponse> {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
