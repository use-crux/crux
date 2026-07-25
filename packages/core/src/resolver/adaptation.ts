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
import type { ResolvedPromptText } from "./prompt-content";
import { contentText } from "../content";
import { isMessageContent } from "../content/guards";
import { coalescePromptTextSegments } from "../prompt-text/render";

/** Exact boundary created while folding composed system text into messages. */
export interface FoldedSystemBoundary {
  readonly messages: AnyMessage[];
  readonly targetMessageIndex: number;
  readonly foldedPrefix: string;
  readonly prefixLength: number;
  readonly hasTrustedSuffix: boolean;
}

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

/** Apply provider-specific prompt text while retaining structural segments. */
export function applyPromptAdaptation(
  promptText: ResolvedPromptText | undefined,
  selected: SelectedPromptAdaptation | undefined,
): ResolvedPromptText | undefined {
  if (promptText === undefined || !selected) return promptText;
  const { adaptation } = selected;
  const prefix = adaptation.prependPrompt ?? "";
  const suffix = adaptation.appendPrompt ?? "";
  const text = `${prefix}${promptText.text}${suffix}`;
  if (!promptText.segments) return { text };
  return {
    text,
    segments: coalescePromptTextSegments([
      ...(prefix ? [{ text: prefix, dynamic: false }] : []),
      ...promptText.segments,
      ...(suffix ? [{ text: suffix, dynamic: false }] : []),
    ]),
  };
}

/** Fold final system text into messages mode without returning a parallel `system` field. */
export function foldSystemIntoMessages(
  system: string,
  messages: readonly AnyMessage[],
): AnyMessage[] {
  return (
    foldSystemIntoMessagesWithBoundary(system, messages)?.messages ?? [
      ...messages,
    ]
  );
}

/** Fold system text and retain the exact private prefix writeback boundary. */
export function foldSystemIntoMessagesWithBoundary(
  system: string,
  messages: readonly AnyMessage[],
): FoldedSystemBoundary | undefined {
  if (!system) return undefined;

  const firstSystemIdx = messages.findIndex(
    (message) => message.role === "system",
  );
  if (firstSystemIdx < 0) {
    return {
      messages: [{ role: "system", content: system }, ...messages],
      targetMessageIndex: 0,
      foldedPrefix: system,
      prefixLength: system.length,
      hasTrustedSuffix: false,
    };
  }

  const first = messages[firstSystemIdx]!;
  const firstContent = isMessageContent(first.content)
    ? contentText(first.content)
    : unknownText(first.content);
  const foldedPrefix = firstContent ? `${system}\n\n` : system;
  const folded = [...messages];
  folded[firstSystemIdx] = {
    ...first,
    content: joinSystemText([system, firstContent]),
  };
  return {
    messages: folded,
    targetMessageIndex: firstSystemIdx,
    foldedPrefix,
    prefixLength: foldedPrefix.length,
    hasTrustedSuffix: firstContent.length > 0,
  };
}

function unknownText(value: unknown): string {
  return String(value);
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
