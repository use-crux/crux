import { contentText, messageText } from "../../content";
import type { Message } from "../../generation/messages";
import type { MessageContent } from "../../types/content";
import { SafetyResultError } from "../errors";
import { createGuardrailPipeline } from "../guardrail/pipeline";
import type {
  GuardrailAudit,
  GuardrailAuditEntry,
  GuardrailContext,
} from "../guardrail/types";
import type { GuardrailBinding } from "../registry";

interface GuardProjectedTextInputOptions {
  readonly bindings: readonly GuardrailBinding[];
  readonly input: {
    readonly messages: readonly Message[];
    readonly prompt?: string;
  };
  readonly context: (messages: readonly Message[]) => GuardrailContext;
}

export interface ProjectedTextInputResult {
  readonly messages: readonly Message[];
  readonly prompt?: string;
  readonly audit?: GuardrailAudit;
  readonly actions: readonly string[];
  readonly ran: boolean;
}

/** Run the existing projected-text input pass and write safe rewrites back. */
export async function guardProjectedTextInput(
  options: GuardProjectedTextInputOptions,
): Promise<ProjectedTextInputResult> {
  const { bindings, input } = options;
  if (bindings.length === 0) return { ...input, actions: [], ran: false };

  const pipeline = createGuardrailPipeline(bindings);
  const actions: string[] = [];
  const applied: GuardrailAuditEntry[] = [];
  let messages = input.messages;
  let guardedAnyMessage = false;

  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (!message || message.role !== "user") continue;

    guardedAnyMessage = true;
    const originalContent = messageText(message);
    const result = await pipeline.runInput(
      originalContent,
      options.context(messages),
    );
    applied.push(...result.audit.applied);
    actions.push(...result.audit.applied.map((entry) => entry.action));

    if (result.content !== originalContent) {
      const content = applyProjectedRewrite(
        message.content as MessageContent,
        originalContent,
        result.content,
      );
      if (content === null) {
        const policyId =
          latestRewritePolicyId(result.audit.applied) ?? "unknown";
        throw new SafetyResultError({
          policyId,
          boundary: "user.input",
          problem:
            "rewrite could not be faithfully applied to multimodal message content",
          message:
            `Safety policy "${policyId}" rewrote a multimodal message projection that no longer aligns with its media placeholders. ` +
            "Media placeholders must be preserved verbatim by rewrites; policies that need to act on media sources should block instead.",
        });
      }
      messages = messages.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, content } : entry,
      );
    }
  }

  if (guardedAnyMessage) {
    return {
      messages,
      prompt: input.prompt,
      audit: { applied, blocked: false },
      actions,
      ran: true,
    };
  }

  if (input.prompt === undefined) return { ...input, actions: [], ran: false };

  const result = await pipeline.runInput(
    input.prompt,
    options.context(input.messages),
  );
  return {
    messages: input.messages,
    prompt: result.content,
    audit: result.audit,
    actions: result.audit.applied.map((entry) => entry.action),
    ran: true,
  };
}

/**
 * Re-apply a guarded projection rewrite to canonical message content.
 *
 * Media placeholders anchor the redistribution: every placeholder must
 * survive the rewrite verbatim, in order, and outside every text segment.
 * Returns `null` when the rewrite cannot be applied faithfully.
 */
export function applyProjectedRewrite(
  content: MessageContent,
  originalProjection: string,
  replacement: string,
): MessageContent | null {
  if (typeof content === "string") return replacement;
  if (contentText(content) !== originalProjection) return null;

  const textCount = content.filter((part) => part.type === "text").length;
  const placeholders = content
    .filter((part) => part.type !== "text")
    .map((part) => contentText([part]));

  if (placeholders.length === 0) {
    let leadingEmpty = 0;
    for (const part of content) {
      if (part.type !== "text" || part.text !== "") break;
      leadingEmpty++;
    }
    let text = replacement;
    while (leadingEmpty > 0 && text.startsWith("\n")) {
      text = text.slice(1);
      leadingEmpty--;
    }
    let first = true;
    return content.map((part) => {
      if (part.type !== "text") return part;
      const value = first ? text : "";
      first = false;
      return { ...part, text: value };
    });
  }
  if (textCount === 0) return null;
  const spoofed = content.some(
    (part) =>
      part.type === "text" &&
      placeholders.some((placeholder) => part.text.includes(placeholder)),
  );
  if (spoofed) return null;

  const out: string[] = [];
  let cursor = 0;
  let pendingText = 0;

  for (const part of content) {
    if (part.type === "text") {
      pendingText++;
      continue;
    }

    const placeholder = contentText([part]);
    const placeholderIndex = replacement.indexOf(placeholder, cursor);
    if (placeholderIndex < 0) return null;
    assignTextChunk(
      out,
      pendingText,
      replacement.slice(cursor, placeholderIndex),
      placeholderIndex > cursor,
    );
    pendingText = 0;
    cursor = placeholderIndex + placeholder.length;
  }

  assignTextChunk(out, pendingText, replacement.slice(cursor), false);
  if (out.length > textCount) return null;
  if (
    out.some((chunk) =>
      placeholders.some((placeholder) => chunk.includes(placeholder)),
    )
  )
    return null;

  let textIndex = 0;
  return content.map((part) => {
    if (part.type !== "text") return part;
    const text = out[textIndex] ?? "";
    textIndex++;
    return { ...part, text };
  });
}

function assignTextChunk(
  out: string[],
  pendingText: number,
  chunk: string,
  beforeMedia: boolean,
): void {
  if (pendingText === 0) return;
  let text = chunk;
  if (text.startsWith("\n")) text = text.slice(1);
  if (beforeMedia && text.endsWith("\n")) text = text.slice(0, -1);
  out.push(text);
  for (let index = 1; index < pendingText; index++) out.push("");
}

function latestRewritePolicyId(
  entries: readonly GuardrailAuditEntry[],
): string | undefined {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (!entry) continue;
    if (
      entry.action === "redact" ||
      entry.action === "transform" ||
      entry.action === "rewrite"
    )
      return entry.guard;
  }
  return undefined;
}
