/**
 * User-prompt resolution and inspection.
 *
 * Authored PromptText is lowered here so provider-neutral resolver output
 * remains plain text while inspection can retain structural segments.
 *
 * @module
 */

import type { ContextTextSegment } from "../prompt/context-types";
import type { PromptText } from "../prompt-text";
import {
  contextualizePromptTextError,
  isPromptText,
  lowerPromptText,
} from "../prompt-text/internal";

/** A resolved user prompt before provider adaptation and public projection. */
export interface ResolvedPromptText {
  readonly text: string;
  readonly segments?: readonly ContextTextSegment[];
}

/** Additive inspection detail for a nonempty resolved user prompt. */
export interface ResolvedPromptTextInspection {
  readonly text: string;
  readonly tokens: number;
  readonly segments?: readonly ContextTextSegment[];
  readonly staticTokens?: number;
  readonly dynamicTokens?: number;
}

/** Resolve direct or synchronous callback-authored user-prompt content. */
export function resolvePromptText<T>(
  value:
    | string
    | PromptText
    | ((arg: { input: T }) => string | PromptText)
    | undefined,
  input: T,
  promptId?: string,
): ResolvedPromptText | undefined {
  try {
    if (value === undefined) return undefined;
    const result = typeof value === "function" ? value({ input }) : value;
    if (result === null || result === undefined) return { text: "" };
    if (typeof result === "string") return { text: result };
    if (isPromptText(result)) return lowerPromptText(result);
    if (typeof result === "object") consumeNativePromiseRejection(result);
    throw new Error(
      `Prompt function must return a string or PromptText, got ${typeof result}. Prompt callbacks must be synchronous; Promise results are not supported.`,
    );
  } catch (error) {
    throw contextualizePromptTextError(
      error,
      `in prompt "${promptId ?? "unknown"}" field "prompt"`,
    );
  }
}

/**
 * Mark a genuine native Promise rejection handled without observing arbitrary
 * object properties. The intrinsic brand check throws before Proxy traps or
 * thenable getters can run for non-Promise values.
 */
function consumeNativePromiseRejection(value: object): void {
  try {
    void Promise.prototype.then.call(value, undefined, () => undefined);
  } catch {
    // Non-Promise objects remain invalid callback results.
  }
}

/** Build prompt inspection with the active tokenizer. */
export function inspectPromptText(
  value: ResolvedPromptText | undefined,
  count: (text: string) => number,
): ResolvedPromptTextInspection | undefined {
  if (!value?.text) return undefined;
  const { text, segments } = value;
  if (!segments || segments.length === 0) {
    return { text, tokens: count(text) };
  }
  return {
    text,
    tokens: count(text),
    segments,
    staticTokens: segments
      .filter((segment) => !segment.dynamic)
      .reduce((total, segment) => total + count(segment.text), 0),
    dynamicTokens: segments
      .filter((segment) => segment.dynamic)
      .reduce((total, segment) => total + count(segment.text), 0),
  };
}
