/** Canonical buffered stream-completion guarding. @internal */

import type { AssistantContentPart } from "../../types/content";
import { createGuardrailPipeline } from "../guardrail/pipeline";
import type { GuardrailAudit, GuardrailContext } from "../guardrail/types";
import type { GuardrailBinding } from "../registry";
import type { SafetyProtocolEvent } from "../session";
import { guardOutputMedia } from "./media";

/** Exact source/output ownership for one independently emitted live delta. */
export interface LiveTextSlot {
  readonly providerText: string;
  readonly guardedText: string;
}

interface GuardStreamCompletionOptions {
  /** Exact buffered assistant content reported when the stream completed. */
  readonly content: readonly AssistantContentPart[];
  /** Authoritative guarded live text, or undefined when no text was streamed. */
  readonly liveText?: string;
  /** Provider text represented by live text before enforcing rewrites. */
  readonly representedText?: string;
  /** Exact source/output ownership for independently emitted live deltas. */
  readonly liveTextSlots?: readonly LiveTextSlot[];
  /** Enabled output bindings for this Safety session. */
  readonly bindings: readonly GuardrailBinding[];
  /** Safe policy context for this call. */
  readonly context: GuardrailContext;
  /** Append one policy pass to the call-level audit. */
  readonly appendAudit: (audit: GuardrailAudit) => void;
  /** Session protocol ledger shared by both stream dialects. */
  readonly transcript: SafetyProtocolEvent[];
}

/**
 * Guard canonical content buffered behind a live text stream.
 *
 * Media and completion-only text use stable indexes from the original
 * completion projection. Text represented by `liveText` remains owned by
 * `SafetyStream` and is synchronized without running its policies again.
 */
export async function guardStreamCompletionContent(
  options: GuardStreamCompletionOptions,
): Promise<readonly AssistantContentPart[]> {
  const mediaBindings = options.bindings.filter(
    (binding) => binding.boundary.id === "model.output.media",
  );
  const textBindings = options.bindings.filter(
    (binding) => binding.boundary.id === "model.output.text",
  );
  const representedPrefixes = findRepresentedTextPrefixes(
    options.content,
    options.representedText,
  );
  if (mediaBindings.length === 0 && textBindings.length === 0) {
    return synchronizeLiveText(
      indexContent(options.content),
      options.liveText,
      representedPrefixes,
      options.liveTextSlots,
    );
  }

  const pipeline = createGuardrailPipeline(textBindings);
  const content: IndexedPart[] = [];
  const actions: string[] = [];
  for (const [partIndex, part] of options.content.entries()) {
    if (part.type === "tool-call") {
      content.push({ part, originalIndex: partIndex });
      continue;
    }
    if (part.type === "text" || part.type === "reasoning") {
      const representedLength =
        part.type === "text" ? (representedPrefixes.get(partIndex) ?? 0) : 0;
      if (representedLength === part.text.length || textBindings.length === 0) {
        content.push({ part, originalIndex: partIndex });
        continue;
      }
      const completionOnlyText = part.text.slice(representedLength);
      const guarded = await pipeline.runOutput(
        completionOnlyText,
        options.context,
      );
      options.appendAudit(guarded.audit);
      actions.push(...guarded.audit.applied.map((entry) => entry.action));
      const text = part.text.slice(0, representedLength) + guarded.content;
      content.push({
        originalIndex: partIndex,
        part: text === part.text ? part : Object.freeze({ ...part, text }),
      });
      continue;
    }
    if (mediaBindings.length === 0) {
      content.push({ part, originalIndex: partIndex });
      continue;
    }
    const guarded = await guardOutputMedia({
      bindings: mediaBindings,
      subjects: [
        {
          part,
          origin: { kind: "step", stepIndex: 0, partIndex },
        },
      ],
      minimumRetained: 0,
      context: options.context,
      appendAudit: options.appendAudit,
    });
    actions.push(...guarded.actions);
    if (guarded.subjects.length > 0) {
      content.push({ part, originalIndex: partIndex });
    }
  }
  if (actions.length > 0) {
    options.transcript.push({
      t: "output.guard",
      guards: textBindings.length + mediaBindings.length,
      actions,
    });
  }
  return synchronizeLiveText(
    content,
    options.liveText,
    representedPrefixes,
    options.liveTextSlots,
  );
}

interface IndexedPart {
  readonly part: AssistantContentPart;
  readonly originalIndex: number;
}

function indexContent(
  content: readonly AssistantContentPart[],
): readonly IndexedPart[] {
  return content.map((part, originalIndex) => ({ part, originalIndex }));
}

function synchronizeLiveText(
  content: readonly IndexedPart[],
  liveText: string | undefined,
  representedPrefixes: ReadonlyMap<number, number>,
  liveTextSlots?: readonly LiveTextSlot[],
): readonly AssistantContentPart[] {
  if (liveText === undefined) {
    return Object.freeze(content.map(({ part }) => part));
  }
  const representedParts = content.filter(
    ({ part, originalIndex }) =>
      part.type === "text" && (representedPrefixes.get(originalIndex) ?? 0) > 0,
  );
  if (representedParts.length === 0) {
    const parts = content.map(({ part }) => part);
    return liveText === ""
      ? Object.freeze(parts)
      : Object.freeze([{ type: "text", text: liveText }, ...parts]);
  }
  const guardedPrefixes = liveTextSlots
    ? mapGuardedPrefixes(content, representedPrefixes, liveTextSlots)
    : undefined;
  if (guardedPrefixes) {
    return Object.freeze(
      content.map(({ part, originalIndex }) => {
        if (part.type !== "text") return part;
        const representedLength = representedPrefixes.get(originalIndex) ?? 0;
        if (representedLength === 0) return part;
        const text =
          (guardedPrefixes.get(originalIndex) ?? "") +
          part.text.slice(representedLength);
        return text === part.text ? part : Object.freeze({ ...part, text });
      }),
    );
  }
  const providerText = representedParts
    .map(({ part, originalIndex }) =>
      part.type === "text"
        ? part.text.slice(0, representedPrefixes.get(originalIndex))
        : "",
    )
    .join("");
  if (providerText === liveText) {
    return Object.freeze(content.map(({ part }) => part));
  }

  let replaced = false;
  return Object.freeze(
    content.flatMap(
      ({ part, originalIndex }): readonly AssistantContentPart[] => {
        const representedLength = representedPrefixes.get(originalIndex) ?? 0;
        if (part.type !== "text" || representedLength === 0) return [part];
        const suffix = part.text.slice(representedLength);
        const text = replaced ? suffix : liveText + suffix;
        replaced = true;
        if (text === "") return [];
        return [part.text === text ? part : Object.freeze({ ...part, text })];
      },
    ),
  );
}

function mapGuardedPrefixes(
  content: readonly IndexedPart[],
  representedPrefixes: ReadonlyMap<number, number>,
  slots: readonly LiveTextSlot[],
): ReadonlyMap<number, string> | undefined {
  const guarded = new Map<number, string>();
  let slotIndex = 0;
  for (const { part, originalIndex } of content) {
    const representedLength = representedPrefixes.get(originalIndex) ?? 0;
    if (part.type !== "text" || representedLength === 0) continue;
    const providerPrefix = part.text.slice(0, representedLength);
    let consumed = "";
    let replacement = "";
    while (consumed.length < providerPrefix.length) {
      const slot = slots[slotIndex];
      if (!slot || !providerPrefix.startsWith(consumed + slot.providerText)) {
        return undefined;
      }
      consumed += slot.providerText;
      replacement += slot.guardedText;
      slotIndex += 1;
    }
    if (consumed !== providerPrefix) return undefined;
    guarded.set(originalIndex, replacement);
  }
  return slotIndex === slots.length ? guarded : undefined;
}

function findRepresentedTextPrefixes(
  content: readonly AssistantContentPart[],
  representedText: string | undefined,
): ReadonlyMap<number, number> {
  const represented = new Map<number, number>();
  if (representedText === undefined || representedText === "") {
    return represented;
  }

  let remaining = representedText;
  for (const [partIndex, part] of content.entries()) {
    if (part.type !== "text" || part.text === "") continue;
    if (remaining.startsWith(part.text)) {
      represented.set(partIndex, part.text.length);
      remaining = remaining.slice(part.text.length);
      if (remaining === "") return represented;
      continue;
    }
    if (part.text.startsWith(remaining)) {
      represented.set(partIndex, remaining.length);
      return represented;
    }
    return new Map();
  }
  return new Map();
}
