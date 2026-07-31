/**
 * Public contracts for canonical conversation Threads.
 *
 * A Thread exposes exact application history. Model-facing projection remains
 * a separate context-policy concern.
 *
 * @module
 */

import type { Message } from "../generation/messages";
import type { Storage } from "../storage";

type UserMessage = Exclude<Message, { role: "assistant" }>;

/** Input to {@link Thread.append}, with an optional caller-stable identity. */
export type ThreadMessageInput = Message & { readonly id?: string };

/** Replacement content for an immutable user-message edit. */
export interface ThreadEditPatch {
  /** Optional caller-stable identity for retry-safe editing. */
  readonly id?: string;
  /** Replacement user content; the original message role is preserved. */
  readonly content: UserMessage["content"];
  /** Optional replacement metadata. */
  readonly metadata?: UserMessage["metadata"];
}

/** A live canonical message on a Thread path. */
export type ThreadMessage = Message & {
  readonly kind: "message";
  readonly id: string;
  readonly parentId?: string;
  readonly createdAt: string;
  readonly variant?: ThreadVariantInfo;
};

/** Navigation metadata for a message with sibling alternatives. */
export interface ThreadVariantInfo {
  readonly index: number;
  readonly count: number;
  readonly previous?: string;
  readonly next?: string;
}

/** A structurally retained entry hidden from normal projection. */
export interface RemovedThreadEntry {
  readonly kind: "removed";
  readonly id: string;
  readonly parentId?: string;
  readonly createdAt: string;
}

/** An irreversible provenance tombstone. */
export interface RedactedThreadEntry {
  readonly kind: "redacted";
  readonly id: string;
  readonly parentId?: string;
}

/** One structural entry on a Thread path. */
export type ThreadEntry =
  | ThreadMessage
  | RemovedThreadEntry
  | RedactedThreadEntry;

/** An exact, root-to-head view of one Thread path. */
export interface ThreadSnapshot {
  readonly threadId: string;
  readonly head?: string;
  readonly entries: readonly ThreadEntry[];
  /** Cursor for the next older group-safe page. */
  readonly cursor?: string;
}

/** Immutable receipt for one published causal group. */
export interface ThreadCommit {
  /** Whether this append advanced the selected head or published a branch. */
  readonly status: "selected" | "alternative";
  /** Ordered identities assigned to the appended messages. */
  readonly messageIds: readonly string[];
  /** Structural parent observed by the append, absent at the root. */
  readonly parentId?: string;
  /** Selected head at the instant this receipt was committed. */
  readonly selectedHead: string;
  /** Timestamp shared by the immutable nodes in this causal group. */
  readonly committedAt: string;
  /** Whether caller-stable IDs resolved to an identical prior append. */
  readonly replayed: boolean;
}

/** Options for attaching a causal group. */
export interface AppendOptions {
  /** Attach after this exact group-ending message. */
  readonly after?: string;
}

/** Options for exact path reads and whole-group pagination. */
export interface ThreadReadOptions {
  /** Address the exact structural prefix ending at this message. */
  readonly at?: string;
  /** Read the page immediately before this group-start message. */
  readonly before?: string;
  /** Maximum messages, adjusted to preserve whole causal groups. */
  readonly limit?: number;
}

/** Construction options for {@link Thread}. */
export interface ThreadOptions {
  /** Stable application identity for this conversation. */
  readonly id: string;
  /** Explicit storage binding. Defaults lazily to configured Storage. */
  readonly storage?: Storage;
}

/** Canonical provider-neutral conversation history handle. */
export interface Thread {
  /** Structural tag used by Crux context resolution. */
  readonly _tag: "Thread";
  /** Stable application identity for this conversation. */
  readonly id: string;
  /** Append one canonical message as an atomic causal group. */
  append(
    message: ThreadMessageInput,
    options?: AppendOptions,
  ): Promise<ThreadCommit>;
  /** Append multiple canonical messages as one atomic causal group. */
  append(
    messages: readonly ThreadMessageInput[],
    options?: AppendOptions,
  ): Promise<ThreadCommit>;
  /** Read an exact root-to-head path with optional group-safe pagination. */
  read(options?: ThreadReadOptions): Promise<ThreadSnapshot>;
  /** Read the exact selected revision for one managed invocation. */
  readHistory(): Promise<{
    readonly head?: string;
    readonly messages: readonly Message[];
  }>;
  /** Atomically publish one accepted managed turn after its observed head. */
  commitTurn(turn: {
    readonly messages: readonly Message[];
    readonly after?: string;
  }): Promise<ThreadCommit>;
  /** Create and select an immutable sibling replacement for a user message. */
  edit(messageId: string, patch: ThreadEditPatch): Promise<ThreadCommit>;
  /** Select an existing sibling or ancestor with its remembered continuation. */
  select(messageId: string): Promise<ThreadSnapshot>;
  /** Irreversibly erase provenance for one or more published messages. */
  redact(messageId: string | readonly string[]): Promise<void>;
  /** Permanently delete an unowned Thread and all of its durable records. */
  delete(): Promise<void>;
}
