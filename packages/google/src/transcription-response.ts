import type { GenerateContentResponse } from "@google/genai";

/** Safe facts retained from Google's composed generation response. */
export interface GoogleTranscriptionMetadata {
  readonly responseId?: string;
  readonly modelVersion?: string;
  readonly usage?: {
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly totalTokens?: number;
  };
}

export const GOOGLE_TRANSCRIPT_SCHEMA = {
  type: "object",
  properties: {
    text: { type: "string" },
    language: { type: "string" },
  },
  required: ["text"],
  additionalProperties: false,
} as const;

/** Parse the structured transcript body returned by the composed route. */
export function parseGoogleTranscript(
  text: string | undefined,
): Record<string, unknown> {
  if (!text) return { text: "" };
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : { text: "" };
  } catch {
    throw new TypeError(
      "Google transcription returned invalid structured JSON.",
    );
  }
}

/** Project only safe, stable response metadata into the public result. */
export function googleTranscriptionMetadata(
  raw: GenerateContentResponse,
): GoogleTranscriptionMetadata {
  const usage = raw.usageMetadata;
  return {
    ...(raw.responseId ? { responseId: raw.responseId } : {}),
    ...(raw.modelVersion ? { modelVersion: raw.modelVersion } : {}),
    ...(!usage
      ? {}
      : {
          usage: {
            ...(usage.promptTokenCount === undefined
              ? {}
              : { inputTokens: usage.promptTokenCount }),
            ...(usage.candidatesTokenCount === undefined
              ? {}
              : { outputTokens: usage.candidatesTokenCount }),
            ...(usage.totalTokenCount === undefined
              ? {}
              : { totalTokens: usage.totalTokenCount }),
          },
        }),
  };
}
