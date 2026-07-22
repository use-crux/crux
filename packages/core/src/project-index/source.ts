/**
 * Source-location helpers for authored Crux definitions.
 *
 * Prompt/context/flow definitions use `captureSource()` to record authored
 * source metadata for the Project Index contract.
 *
 * @module
 */

import { z } from "zod";

/** A one-based coordinate in an authored source file. */
export interface SourceLocation {
  file: string;
  line: number;
  column?: number;
  function?: string;
}

/** A one-based source span whose end coordinates may be unavailable. */
export interface SourceRange {
  file: string;
  startLine: number;
  endLine?: number;
  startColumn?: number;
  endColumn?: number;
}

/** Source text captured with the span and language needed to present it. */
export interface SourceSnippet {
  source: string;
  language?: string;
  range: SourceRange;
  truncated?: boolean;
}

export const SourceLocationSchema = z.object({
  file: z.string(),
  line: z.number(),
  column: z.number().optional(),
  function: z.string().optional(),
});

export const SourceRangeSchema = z.object({
  file: z.string(),
  startLine: z.number(),
  endLine: z.number().optional(),
  startColumn: z.number().optional(),
  endColumn: z.number().optional(),
});

export const SourceSnippetSchema = z.object({
  source: z.string(),
  language: z.string().optional(),
  range: SourceRangeSchema,
  truncated: z.boolean().optional(),
});

/** Capture the call-site from the current stack trace. */
export function captureSource(): SourceLocation | undefined {
  const stack = new Error().stack;
  if (!stack) return undefined;

  const lines = stack.split("\n");
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.includes("index/source")) continue;
    if (line.includes("node_modules")) continue;

    const match = line.match(/at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?/);
    if (match) {
      return {
        file: match[2]!,
        line: parseInt(match[3]!, 10),
        column: parseInt(match[4]!, 10),
        ...(match[1] ? { function: match[1] } : {}),
      };
    }
  }

  return undefined;
}
