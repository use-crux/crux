import type { GenerateContentResponse } from "@google/genai";
import type { TranscriptInterval } from "@use-crux/core";

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
    segments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          start: { type: "number" },
          end: { type: "number" },
        },
        required: ["text", "start", "end"],
        additionalProperties: false,
      },
    },
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

/** Validate and normalize measured Google transcript segments. */
export function normalizeGoogleTranscriptTiming(value: unknown): {
  valid: boolean;
  segments: readonly TranscriptInterval[];
} {
  if (!Array.isArray(value) || value.length === 0)
    return { valid: false, segments: [] };
  let previousEnd = 0;
  const segments: TranscriptInterval[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object")
      return { valid: false, segments: [] };
    const record = item as Record<string, unknown>;
    if (
      typeof record.text !== "string" ||
      !record.text.trim() ||
      typeof record.start !== "number" ||
      !Number.isFinite(record.start) ||
      record.start < previousEnd ||
      typeof record.end !== "number" ||
      !Number.isFinite(record.end) ||
      record.end < record.start
    ) {
      return { valid: false, segments: [] };
    }
    segments.push({
      text: record.text.trim(),
      startSecond: record.start,
      endSecond: record.end,
    });
    previousEnd = record.end;
  }
  return { valid: true, segments };
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
