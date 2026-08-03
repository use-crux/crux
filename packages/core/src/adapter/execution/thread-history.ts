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
import type { AssistantContentPart } from "../../types/content";
import type { ManagedThreadPublication } from "../../generation-model/execution-checkpoint";
import type { ThreadHistoryRange } from "../../request/history/source";
import { acceptedThreadTurnMessages } from "./thread-publication";
import { authoredMessages } from "./authored-messages";

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
  readonly basis?: ThreadHistoryRange;
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
  const basis = source.artifactRange?.({
    offset: 0,
    length: history.messageIds.length,
  });
  return {
    resolved,
    historyLength: history.messages.length,
    responseOffset: history.messages.length + authored.length,
    ...(userMessage ? { userMessage } : {}),
    ...(history.head ? { head: history.head } : {}),
    binding,
    source,
    ...(basis ? { basis } : {}),
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
  const publication = prepareThreadPublication(invocation, result);
  return publication
    ? commitThreadPublication(invocation, publication)
    : undefined;
}

/** Prepare canonical owner-Thread evidence without publishing it. @internal */
export function prepareThreadPublication(
  invocation: ManagedThreadInvocation,
  result: ManagedThreadResult,
): ManagedThreadPublication | undefined {
  if (!invocation.binding) return undefined;
  const tail =
    result.messages && result.messages.length > invocation.responseOffset
      ? result.messages.slice(invocation.responseOffset)
      : [];
  const messages = acceptedThreadTurnMessages(
    invocation.userMessage,
    tail,
    result,
  );
  if (messages.length === 0) return undefined;
  return Object.freeze({
    threadId: invocation.binding.id,
    ...(invocation.head ? { after: invocation.head } : {}),
    messages: Object.freeze(messages),
    ...(invocation.basis ? { basis: invocation.basis } : {}),
  });
}

/** Publish one prepared turn through its exact managed Thread binding. @internal */
export async function commitThreadPublication(
  invocation: ManagedThreadInvocation,
  publication: ManagedThreadPublication,
): Promise<ThreadCommit> {
  if (
    !invocation.binding ||
    publication.threadId !== invocation.binding.id ||
    publication.after !== invocation.head
  ) {
    throw new ThreadCommitError(
      "Prepared Thread publication does not match its managed invocation.",
    );
  }
  try {
    return await invocation.binding.commitTurn({
      messages: publication.messages,
      after: publication.after,
    });
  } catch (error) {
    if (error instanceof ThreadCommitError) throw error;
    throw new ThreadCommitError(
      `Thread "${invocation.binding.id}" could not publish the accepted turn.`,
      error,
    );
  }
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
