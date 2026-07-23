/** Shared canonical stream-completion assembly and Safety gate. @internal */

import type { z } from "zod";
import type { Message } from "../../generation/messages";
import type { TraceMeta } from "../../generation/types";
import type { Safety } from "../../safety/session";
import type { SafetyStream } from "../../safety/session";
import { guardSafetySessionStreamCompletion } from "../../safety/session";
import type { LiveTextSlot } from "../../safety/output/completion";
import type { AssistantContentPart } from "../../types/content";
import { responseContent, textFromAssistantContent } from "../assistant-output";
import type { StructuredOutputDecodeManifest } from "../structured-output";
import { createStructuredCompletion } from "./structured-completion";

interface BufferedStreamMeta extends TraceMeta {
  readonly text?: string;
  readonly content?: readonly AssistantContentPart[];
  readonly messages?: readonly Message[];
  readonly warnings?: readonly unknown[];
  readonly providerMetadata?: unknown;
  readonly object?: unknown;
}

interface GuardStreamCompletionOptions {
  readonly safety: Safety;
  readonly meta: BufferedStreamMeta | undefined;
  /** Whether this runtime owns canonical assembly when no policy is active. */
  readonly assembleWithoutSafety: boolean;
  /** Sealed live text, or undefined when the stream emitted no text slot. */
  readonly liveText?: string;
  /** Provider text represented by that live slot before Safety rewrites. */
  readonly representedText?: string;
  /** Exact per-delta ownership when every represented live chunk emitted. */
  readonly liveTextSlots?: readonly LiveTextSlot[];
  readonly messages: readonly Message[];
  /**
   * Authored schema for a structured stream. When present, the terminal
   * completed value is re-derived from the final guarded text so generate and
   * stream completion share identical semantics: manifest decode to `z.input`,
   * then one authored `safeParse`.
   */
  readonly schema?: z.ZodType;
  /** Reversible decode manifest for the compiled plan, when any. */
  readonly decodeManifest?: StructuredOutputDecodeManifest;
  /** Prompt id used in a terminal validation-failure diagnostic. */
  readonly promptId?: string;
}

/**
 * Guard and assemble one buffered completion before exposing it to callers.
 *
 * The raw provider stream is deliberately absent from this operation. Only
 * canonical completion content is rebuilt, and audit is stamped after every
 * completion-only policy has succeeded.
 */
export async function guardStreamCompletion(
  options: GuardStreamCompletionOptions,
): Promise<BufferedStreamMeta | undefined> {
  if (!options.meta && options.liveText === undefined) return undefined;
  // A structured stream must still re-derive its terminal value even when no
  // policy is active and the runtime owns assembly, so keep the fast path for
  // unstructured completions only.
  if (
    !options.safety.enabled &&
    !options.assembleWithoutSafety &&
    !options.schema
  ) {
    return options.meta;
  }

  const providerContent = responseContent({
    content: options.meta?.content,
    text: options.meta?.text ?? options.liveText ?? "",
    toolCalls: options.meta?.toolCalls?.flatMap((call) =>
      typeof call.id === "string"
        ? [{ id: call.id, name: call.name, args: call.args }]
        : [],
    ),
  });
  const representedText =
    options.meta?.content === undefined && options.meta?.text === undefined
      ? options.liveText
      : options.representedText;
  const guardedContent = options.safety.enabled
    ? await guardSafetySessionStreamCompletion(
        options.safety,
        providerContent,
        options.liveText,
        representedText,
        options.liveTextSlots,
      )
    : providerContent;

  let content = guardedContent;
  let text = textFromAssistantContent(content);
  let object: unknown;

  if (options.schema) {
    // Route the completed candidate through the same completed-candidate
    // pipeline as generation: the parsed wire value (not text) is the initial
    // semantic value, manifest-decoded to canonical z.input, guarded by the
    // terminal object/both bindings, then validated by the authored schema
    // exactly once. Streaming is terminal, so there is no corrective reprompt.
    // If completion-text Safety rewrote the JSON, the wire value is stale and
    // the initial value is resynchronized from the rewritten text instead.
    const textRewritten =
      text !== textFromAssistantContent(providerContent);
    const finalized = await finalizeStructuredStreamCompletion({
      safety: options.safety,
      schema: options.schema,
      decodeManifest: options.decodeManifest,
      promptId: options.promptId,
      messages: options.messages,
      text,
      wireValue: textRewritten ? undefined : options.meta?.object,
    });
    object = finalized.object;
    if (finalized.text !== text) {
      text = finalized.text;
      content = replaceAssistantText(content, text);
    }
  }

  const messages = options.meta?.messages
    ? replaceFinalAssistant(options.meta.messages, content, options.meta.toolCalls)
    : [
        ...options.messages,
        createAssistantMessage(content, options.meta?.toolCalls),
      ];

  const result = {
    ...options.meta,
    text,
    content,
    messages,
    ...(options.schema ? { object } : {}),
  };
  return options.safety.enabled ? options.safety.stamp(result) : result;
}

/**
 * Finalize a completed structured stream through the shared completed-candidate
 * pipeline, so generate and stream completion share identical terminal
 * semantics: manifest decode of the wire value to canonical `z.input`, terminal
 * object/both Safety, then the authored schema exactly once. Streaming cannot
 * regenerate, so the corrective reprompt is a budget-exhausted no-op and invalid
 * candidates fail closed.
 */
async function finalizeStructuredStreamCompletion(opts: {
  readonly safety: Safety;
  readonly schema: z.ZodType;
  readonly decodeManifest?: StructuredOutputDecodeManifest;
  readonly promptId?: string;
  readonly messages: readonly Message[];
  readonly text: string;
  readonly wireValue: unknown;
}): Promise<{ readonly text: string; readonly object: unknown }> {
  const completion = createStructuredCompletion({
    safety: opts.safety,
    schema: opts.schema,
    decodeManifest: opts.decodeManifest,
    promptId: opts.promptId ?? "unknown",
    validationRetry: undefined,
    maxSteps: 0,
    steps: () => 0,
    messages: () => opts.messages,
    reprompt: async () => opts.text,
  });
  // The parsed wire value is authoritative for the initial semantic value; when
  // it is absent (a completion-text rewrite made it stale, or a runtime exposed
  // no wire value) the value is resynchronized from the authoritative text.
  const initial =
    opts.wireValue !== undefined
      ? completion.buildFromWireValue({ text: opts.text, value: opts.wireValue })
      : completion.buildFromText(opts.text);
  const finalized = await completion.finalize(initial, { suspended: false });
  return { text: finalized.text, object: finalized.object };
}

/** Replace the assistant text part with rewritten structured text. */
function replaceAssistantText(
  content: readonly AssistantContentPart[],
  text: string,
): readonly AssistantContentPart[] {
  let replaced = false;
  const next = content.map((part) => {
    if (part.type !== "text" || replaced) return part;
    replaced = true;
    return part.text === text ? part : { ...part, text };
  });
  return replaced ? next : [...next, { type: "text", text }];
}

function replaceFinalAssistant(
  messages: readonly Message[],
  content: readonly AssistantContentPart[],
  toolCalls: TraceMeta["toolCalls"],
): readonly Message[] {
  const result = [...messages];
  for (let index = result.length - 1; index >= 0; index -= 1) {
    const current = result[index];
    if (current?.role !== "assistant") continue;
    const metadata = toolCalls
      ? { ...current.metadata, toolCalls }
      : current.metadata;
    result[index] = {
      ...current,
      content,
      ...(metadata !== undefined ? { metadata } : {}),
    };
    return result;
  }
  result.push(createAssistantMessage(content, toolCalls));
  return result;
}

function createAssistantMessage(
  content: readonly AssistantContentPart[],
  toolCalls: TraceMeta["toolCalls"],
): Message {
  return {
    role: "assistant",
    content,
    ...(toolCalls ? { metadata: { toolCalls } } : {}),
  };
}

/** Capture the authoritative seal while preserving the streaming protocol. */
export function trackSafetyStreamSeal(stream: SafetyStream): {
  readonly stream: SafetyStream;
  readonly sealedText: () => string | undefined;
} {
  let sealedText: string | undefined;
  const tracked: SafetyStream = {
    feed: (chunk) => stream.feed(chunk),
    async finish() {
      const seal = await stream.finish();
      sealedText = seal.text;
      return seal;
    },
    transform() {
      return new TransformStream<string, string>({
        async transform(chunk, controller) {
          const directive = await tracked.feed(chunk);
          if (directive.kind === "emit" && directive.content.length > 0) {
            controller.enqueue(directive.content);
          }
        },
        async flush(controller) {
          const seal = await tracked.finish();
          if (seal.pending.length > 0) controller.enqueue(seal.pending);
        },
      });
    },
  };
  return { stream: tracked, sealedText: () => sealedText };
}
