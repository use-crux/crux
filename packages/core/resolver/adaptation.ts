/**
 * Provider adaptation helpers for prompt resolution.
 *
 * Adaptations are selected by provider/model metadata but applied inside the
 * resolver's provider-neutral artifact model. Keeping the string folding here
 * keeps `runPromptPass` focused on pass ordering while preserving one public
 * resolution boundary for tests and adapters.
 *
 * @module
 */

import type { AnyMessage } from "../types";
import type { SelectedPromptAdaptation } from "./prompt-settings";
import type { SystemBlock } from "./types";
import { contentText } from "../content";
import { isMessageContent } from "../content/guards";

/** Apply provider-specific system text around the composed system message. */
export function applySystemAdaptationText(
  system: string,
  selected: SelectedPromptAdaptation | undefined,
): string {
  if (!selected) return system;
  const { adaptation } = selected;
  return joinSystemText([
    adaptation.prependSystem,
    system,
    adaptation.appendSystem,
  ]);
}

/** Insert provider-specific system text into the typed system block list. */
export function applySystemAdaptationBlocks(
  blocks: readonly SystemBlock[],
  selected: SelectedPromptAdaptation | undefined,
): SystemBlock[] {
  if (!selected) return [...blocks];
  const { key, adaptation } = selected;
  const adapted = [...blocks];

  if (adaptation.prependSystem) {
    adapted.splice(
      prependInsertionIndex(adapted),
      0,
      adaptationBlock(key, adaptation.prependSystem),
    );
  }
  if (adaptation.appendSystem) {
    adapted.push(adaptationBlock(key, adaptation.appendSystem));
  }

  return adapted;
}

/** Apply provider-specific prompt text around the rendered prompt string. */
export function applyPromptAdaptationText(
  promptText: string | undefined,
  selected: SelectedPromptAdaptation | undefined,
): string | undefined {
  if (promptText === undefined || !selected) return promptText;
  const { adaptation } = selected;
  return `${adaptation.prependPrompt ?? ""}${promptText}${adaptation.appendPrompt ?? ""}`;
}

/** Fold final system text into messages mode without returning a parallel `system` field. */
export function foldSystemIntoMessages(
  system: string,
  messages: readonly AnyMessage[],
): AnyMessage[] {
  if (!system) return [...messages];

  const firstSystemIdx = messages.findIndex(
    (message) => message.role === "system",
  );
  if (firstSystemIdx < 0) {
    return [{ role: "system", content: system }, ...messages];
  }

  const first = messages[firstSystemIdx]!;
  const firstContent =
    isMessageContent(first.content) ? contentText(first.content) : unknownText(first.content);
  const folded = [...messages];
  folded[firstSystemIdx] = {
    ...first,
    content: joinSystemText([system, firstContent]),
  };
  return folded;
}

function unknownText(value: unknown): string {
  return String(value)
}

/** Join system fragments with the resolver's canonical separator, omitting empty fragments. */
export function joinSystemText(parts: readonly (string | undefined)[]): string {
  return parts.filter(isNonEmptyString).join("\n\n");
}

function isNonEmptyString(value: string | undefined): value is string {
  return value !== undefined && value.length > 0;
}

function prependInsertionIndex(blocks: readonly SystemBlock[]): number {
  const cacheBoundaryIndex = blocks.findIndex((block) => block.cacheBoundary);
  if (cacheBoundaryIndex >= 0) return cacheBoundaryIndex + 1;
  return blocks[0]?.source === "prompt" ? 1 : 0;
}

function adaptationBlock(key: string, text: string): SystemBlock {
  return {
    source: `adaptation:${key}`,
    text,
    providerCache: false,
  };
}
