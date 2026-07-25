/**
 * Markdown-oriented prompt text composition.
 *
 * @module
 */

import { createJsonPromptText, createPromptText } from "./internal";

declare const promptTextBrand: unique symbol;

/**
 * Opaque structured prompt text created by {@link md}.
 *
 * `PromptText` is immutable and cannot be converted to a string directly.
 * Crux lowers it when resolving an accepted prompt or context field.
 */
export interface PromptText {
  readonly [promptTextBrand]: true;
}

type PromptTextValue =
  | string
  | number
  | PromptText
  | false
  | null
  | undefined
  | readonly PromptTextValue[];

interface MdTag {
  (strings: TemplateStringsArray, ...values: PromptTextValue[]): PromptText;

  /**
   * Snapshot a value as two-space-indented JSON prompt text.
   *
   * This helper uses native `JSON.stringify` behavior. It does not sanitize,
   * redact, sort, fence, or otherwise transform the resulting JSON.
   */
  json(value: unknown): PromptText;
}

function createMarkdownPromptText(
  strings: TemplateStringsArray,
  ...values: PromptTextValue[]
): PromptText {
  return createPromptText(strings, values);
}

/**
 * Compose Markdown-oriented prompt text with native TypeScript expressions.
 *
 * @example
 * ```ts
 * const rules = md`
 *   ## Rules
 *
 *   ${items.map((item) => md`- ${item}`)}
 * `
 * ```
 */
export const md: MdTag = Object.assign(createMarkdownPromptText, {
  json: createJsonPromptText,
});
