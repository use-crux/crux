/** Shared canonical stream-completion assembly and Safety gate. @internal */

import type { Message } from "../../generation/messages";
import type { TraceMeta } from "../../generation/types";
import type { Safety } from "../../safety/session";
import type { SafetyStream } from "../../safety/session";
import { guardSafetySessionStreamCompletion } from "../../safety/session";
import type { AssistantContentPart } from "../../types/content";
import { responseContent, textFromAssistantContent } from "../assistant-output";

interface BufferedStreamMeta extends TraceMeta {
  readonly text?: string;
  readonly content?: readonly AssistantContentPart[];
  readonly messages?: readonly Message[];
  readonly warnings?: readonly unknown[];
  readonly providerMetadata?: unknown;
}

interface GuardStreamCompletionOptions {
  readonly safety: Safety;
  readonly meta: BufferedStreamMeta | undefined;
  /** Sealed live text, or undefined when the stream emitted no text slot. */
  readonly liveText?: string;
  /** Provider text represented by that live slot before Safety rewrites. */
  readonly representedText?: string;
  readonly messages: readonly Message[];
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
  if (!options.safety.enabled) return options.meta;
  if (!options.meta && options.liveText === undefined) return undefined;

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
  const content = await guardSafetySessionStreamCompletion(
    options.safety,
    providerContent,
    options.liveText,
    representedText,
  );
  const text = textFromAssistantContent(content);
  const messages = options.meta?.messages
    ? replaceFinalAssistant(
        options.meta.messages,
        content,
        options.meta.toolCalls,
      )
    : [
        ...options.messages,
        createAssistantMessage(content, options.meta?.toolCalls),
      ];

  return options.safety.stamp({
    ...options.meta,
    text,
    content,
    messages,
  });
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
