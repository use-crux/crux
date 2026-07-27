/**
 * Message helpers for adapter execution.
 *
 * The two adapter dialects start conversations differently: core-step adapters
 * always need a concrete message list, while SDK-loop executors may pass a
 * prompt string until history exists. These helpers keep that shaping explicit.
 *
 * @internal
 * @module
 */

import type { Message } from "../../generation/messages";
import type { AssistantContentPart } from "../../types/content";
import { replaceTextSlots } from "./stream-content";
import type { AdapterResponse } from "../types";
import { responseContent } from "../assistant-output";

/** Internal ownership of the canonical messages selected for initial delivery. */
export type InitialMessageSource =
  | "explicit-history"
  | "native-history"
  | "resolved-messages"
  | "resolved-prompt"
  | "empty";

/** Initial canonical input selected together with its resolver ownership. */
export interface InitialMessageState {
  readonly messages: Message[];
  readonly promptText: string | undefined;
  readonly source: InitialMessageSource;
}

/**
 * Append the final assistant response to a provider-agnostic Crux transcript.
 *
 * Approval suspension skips this helper because the approval-request message
 * is already sealed by `ToolLifecycle.suspend()`.
 */
export function appendAssistantResultMessage(
  messages: Message[],
  response: AdapterResponse | undefined,
): Message[] {
  if (!response) return messages;
  return [
    ...messages,
    {
      role: "assistant" as const,
      content: responseContent(response),
      ...(response.toolCalls
        ? { metadata: { toolCalls: response.toolCalls } }
        : {}),
    },
  ];
}

/**
 * Build initial SDK-loop message state.
 *
 * If the caller did not provide history, a plain resolved prompt is preserved
 * as `promptText` so SDKs that accept prompt strings can use their native path.
 */
export function initialMessageState(
  resolved: {
    readonly prompt?: string;
    readonly messages?: readonly unknown[];
  },
  messages?: Message[],
  nativeMessages?: readonly unknown[],
): InitialMessageState {
  const history: Message[] = [...(messages ?? [])];
  if (nativeMessages && nativeMessages.length > 0) {
    return {
      messages: history,
      promptText: undefined,
      source: "native-history",
    };
  }
  let promptText: string | undefined;
  let source: InitialMessageSource = history.length
    ? "explicit-history"
    : "empty";
  if (history.length === 0 && resolved.prompt) {
    promptText = resolved.prompt;
    source = "resolved-prompt";
  } else if (history.length === 0 && resolved.messages) {
    history.push(...(resolved.messages as Message[]));
    source = "resolved-messages";
  }
  return { messages: history, promptText, source };
}

/**
 * Build initial core-step messages.
 *
 * Core-step providers always receive messages, so a resolved prompt string is
 * converted into a first user message when no history exists.
 */
export function initialCoreMessageState(
  resolved: {
    readonly prompt?: string;
    readonly messages?: readonly unknown[];
  },
  messages?: Message[],
): InitialMessageState {
  const history: Message[] = [...(messages ?? [])];
  let source: InitialMessageSource = history.length
    ? "explicit-history"
    : "empty";
  if (history.length === 0 && resolved.prompt) {
    history.push({ role: "user", content: resolved.prompt });
    source = "resolved-prompt";
  } else if (history.length === 0 && resolved.messages) {
    history.push(...(resolved.messages as Message[]));
    source = "resolved-messages";
  }
  return { messages: history, promptText: undefined, source };
}

/**
 * Append a failed assistant output plus validation feedback as a user turn.
 *
 * Used by structured retry so the model sees both the invalid output and the
 * corrective instruction in the next attempt.
 */
export function appendCorrectiveExchange(
  promptText: string | undefined,
  messages: readonly Message[],
  failedOutput: string,
  feedback: string,
): Message[] {
  return appendCorrectiveMessages(promptText, messages, failedOutput, [
    { role: "user", content: feedback },
  ]);
}

/**
 * Append arbitrary corrective messages after a failed assistant output.
 *
 * If the conversation was still represented as a prompt string, the prompt is
 * first materialized as a user message to create a valid transcript.
 */
export function appendCorrectiveMessages(
  promptText: string | undefined,
  messages: readonly Message[],
  failedOutput: string,
  corrective: readonly Message[],
): Message[] {
  const base: Message[] =
    messages.length > 0
      ? [...messages]
      : promptText
        ? [{ role: "user", content: promptText }]
        : [];
  return [
    ...base,
    { role: "assistant", content: failedOutput || "Invalid output" },
    ...corrective,
  ];
}

/**
 * Replace the settled SDK transcript's final assistant candidate before retry.
 *
 * Loop-owning runtimes already return the rejected assistant turn in their
 * canonical transcript. Retry guarding must update that turn rather than append
 * a duplicate. String content remains a string. Rich content retains reasoning,
 * media, tool calls, provider options, and metadata while its text slots become
 * exactly the guarded rejected output.
 */
export function replaceFinalAssistantOutput(
  messages: readonly Message[],
  rejectedOutput: string,
): Message[] {
  let index = -1;
  for (
    let messageIndex = messages.length - 1;
    messageIndex >= 0;
    messageIndex--
  ) {
    if (messages[messageIndex]?.role === "assistant") {
      index = messageIndex;
      break;
    }
  }
  if (index < 0) {
    return [...messages, { role: "assistant", content: rejectedOutput }];
  }
  return messages.map((message, messageIndex) =>
    messageIndex === index && message.role === "assistant"
      ? {
          ...message,
          content: replaceAssistantOutputText(message.content, rejectedOutput),
        }
      : message,
  );
}

function replaceAssistantOutputText(
  content: string | readonly AssistantContentPart[],
  text: string,
): string | readonly AssistantContentPart[] {
  if (typeof content === "string") return text;
  const textSlots = content.filter((part) => part.type === "text");
  return replaceTextSlots(
    content,
    textSlots.map((_, index) => (index === 0 ? text : "")),
    text,
  );
}
