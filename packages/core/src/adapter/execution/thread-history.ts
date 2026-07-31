/**
 * Managed execution policy for canonical Thread history.
 *
 * One invocation reads one exact revision, projects it into model-facing
 * messages, and publishes only the accepted turn after that observed head.
 *
 * @internal
 * @module
 */

import type { Message } from "../../generation/messages";
import type { ResolvedPrompt } from "../../resolver/types";
import {
  threadHistorySource,
  type HistorySource,
} from "../../request/history/source";
import { ThreadCommitError } from "../../thread/errors";
import type { ThreadCommit } from "../../thread/types";
import type { AssistantContentPart, ToolCallPart } from "../../types/content";

/** Observable reason a resolved Thread did not participate in one invocation. */
export interface ThreadHistoryOverride {
  readonly threadId: string;
  readonly reason: "explicit-messages" | "prompt-messages";
}

/** Exact Thread state retained for one managed invocation. */
export interface ManagedThreadInvocation {
  readonly resolved: ResolvedPrompt;
  readonly historyLength: number;
  readonly responseOffset: number;
  readonly userMessage?: Message;
  readonly head?: string;
  readonly binding?: NonNullable<ResolvedPrompt["threadBinding"]>;
  readonly source?: HistorySource;
  readonly override?: ThreadHistoryOverride;
}

/** Read and project one exact Thread revision before provider I/O. */
export async function prepareThreadInvocation(
  resolved: ResolvedPrompt,
  explicitMessages: readonly Message[] | undefined,
): Promise<ManagedThreadInvocation> {
  const binding = resolved.threadBinding;
  if (!binding) return { resolved, historyLength: 0, responseOffset: 0 };
  if (explicitMessages !== undefined) {
    return {
      resolved,
      historyLength: 0,
      responseOffset: 0,
      override: { threadId: binding.id, reason: "explicit-messages" },
    };
  }

  if (resolved.messages !== undefined) {
    return {
      resolved,
      historyLength: 0,
      responseOffset: 0,
      override: { threadId: binding.id, reason: "prompt-messages" },
    };
  }

  const history = await binding.readHistory();
  const authored = authoredMessages(resolved);
  const userMessage = findRenderedUserMessage(authored);
  const source = threadHistorySource({
    id: binding.id,
    revision: history.revision,
    messages: history.messages,
    messageIds: history.messageIds,
    current: authored,
    validate: () => binding.validateRevision(history.revision),
  });
  return {
    resolved,
    historyLength: history.messages.length,
    responseOffset: history.messages.length + authored.length,
    ...(userMessage ? { userMessage } : {}),
    ...(history.head ? { head: history.head } : {}),
    binding,
    source,
  };
}

/** Accepted output facts needed to publish one managed Thread turn. */
export interface ManagedThreadResult {
  readonly messages?: readonly Message[];
  readonly content?: readonly AssistantContentPart[];
  readonly text?: string;
}

/** Reject a cached replay when its observed Thread revision is no longer current. */
export async function validateThreadReplay(
  invocation: ManagedThreadInvocation,
  replay: boolean,
): Promise<void> {
  if (replay) await invocation.source?.validate?.();
}

/** Return whether a generated result came from semantic-cache replay. */
export function isThreadReplay(result: { readonly _meta?: unknown }): boolean {
  if (
    typeof result._meta !== "object" ||
    result._meta === null ||
    !("semanticCache" in result._meta)
  ) {
    return false;
  }
  const cache = result._meta.semanticCache;
  if (typeof cache !== "object" || cache === null) return false;
  const facts = cache as Readonly<Record<string, unknown>>;
  return facts.hit === true || facts.replay === true;
}

/** Align the managed turn boundary with the post-Safety provider input. */
export function alignThreadInvocationInput(
  invocation: ManagedThreadInvocation,
  input: {
    readonly messages: readonly Message[];
    readonly prompt?: string;
  },
  historyLength = invocation.historyLength,
): ManagedThreadInvocation {
  if (!invocation.binding) return invocation;
  const canonical = [
    ...input.messages,
    ...(input.prompt ? [{ role: "user" as const, content: input.prompt }] : []),
  ];
  const userMessage = findRenderedUserMessage(canonical.slice(historyLength));
  const { userMessage: _previousUser, ...withoutUser } = invocation;
  return {
    ...withoutUser,
    responseOffset: canonical.length,
    ...(userMessage ? { userMessage } : {}),
  };
}

/** Publish the rendered user turn and terminal accepted assistant response. */
export async function commitThreadInvocation(
  invocation: ManagedThreadInvocation,
  result: ManagedThreadResult,
): Promise<ThreadCommit | undefined> {
  if (!invocation.binding) return undefined;
  const tail =
    result.messages && result.messages.length > invocation.responseOffset
      ? result.messages.slice(invocation.responseOffset)
      : [];
  const messages = acceptedTurnMessages(invocation.userMessage, tail, result);
  if (messages.length === 0) return undefined;
  try {
    return await invocation.binding.commitTurn({
      messages,
      after: invocation.head,
    });
  } catch (error) {
    if (error instanceof ThreadCommitError) throw error;
    throw new ThreadCommitError(
      `Thread "${invocation.binding.id}" could not publish the accepted turn.`,
      error,
    );
  }
}

function acceptedAssistant(result: ManagedThreadResult): Message | undefined {
  const content =
    result.content !== undefined
      ? result.content
      : result.text !== undefined
        ? [{ type: "text" as const, text: result.text }]
        : undefined;
  if (content === undefined) return undefined;
  return {
    role: "assistant",
    content,
  };
}

function acceptedTurnMessages(
  userMessage: Message | undefined,
  tail: readonly Message[],
  result: ManagedThreadResult,
): Message[] {
  const rounds: Message[] = [];
  let finalAssistant: Message | undefined;
  for (let index = 0; index < tail.length; index++) {
    const message = tail[index];
    if (message?.role !== "assistant") continue;
    const calls = assistantToolCalls(message);
    if (calls.length === 0) {
      finalAssistant = message;
      continue;
    }
    const pending = new Set(calls.map((call) => call.toolCallId));
    const results: Message[] = [];
    for (
      let resultIndex = index + 1;
      resultIndex < tail.length;
      resultIndex++
    ) {
      const result = tail[resultIndex];
      if (result?.role !== "tool") break;
      const toolCallId = result.metadata?.toolCallId;
      if (typeof toolCallId === "string" && pending.delete(toolCallId)) {
        results.push(result);
      }
      index = resultIndex;
    }
    if (pending.size === 0) {
      rounds.push(canonicalToolCallMessage(message, calls), ...results);
    }
  }
  const finalAcceptedAssistant =
    finalAssistant ??
    (tail.length === 0 ? acceptedAssistant(result) : undefined);
  return [
    ...(userMessage ? [userMessage] : []),
    ...rounds,
    ...(finalAcceptedAssistant ? [finalAcceptedAssistant] : []),
  ];
}

function assistantToolCalls(message: Message): readonly ToolCallPart[] {
  if (message.role !== "assistant") return [];
  const contentCalls =
    typeof message.content === "string"
      ? []
      : message.content.filter(
          (part): part is ToolCallPart => part.type === "tool-call",
        );
  if (contentCalls.length > 0) return contentCalls;
  const metadataCalls = message.metadata?.toolCalls;
  if (!Array.isArray(metadataCalls)) return [];
  return metadataCalls.flatMap((call) => {
    if (
      typeof call !== "object" ||
      call === null ||
      !("id" in call) ||
      !("name" in call) ||
      typeof call.id !== "string" ||
      typeof call.name !== "string"
    ) {
      return [];
    }
    return [
      {
        type: "tool-call" as const,
        toolCallId: call.id,
        toolName: call.name,
        input: "args" in call ? call.args : undefined,
      },
    ];
  });
}

function canonicalToolCallMessage(
  message: Extract<Message, { role: "assistant" }>,
  calls: readonly ToolCallPart[],
): Message {
  const content =
    typeof message.content === "string"
      ? [
          ...(message.content
            ? [{ type: "text" as const, text: message.content }]
            : []),
          ...calls,
        ]
      : [
          ...message.content.filter((part) => part.type !== "tool-call"),
          ...calls,
        ];
  return { ...message, content };
}

function authoredMessages(resolved: ResolvedPrompt): readonly Message[] {
  if (resolved.prompt) {
    return [{ role: "user", content: resolved.prompt }];
  }
  return (resolved.messages ?? []) as readonly Message[];
}

function findRenderedUserMessage(
  messages: readonly Message[],
): Message | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.role === "user") return message;
  }
  return undefined;
}
