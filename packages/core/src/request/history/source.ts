/**
 * Provider-neutral history ownership used by request projection.
 *
 * @module
 */

import type { Message } from "../../generation/messages";
import type { RequestWarning } from "../receipt/adaptations";

/** Limits accepted by {@link history.recent}. */
export interface RecentHistoryOptions {
  /** Soft maximum number of conversational messages. */
  readonly messages?: number;
  /** Soft maximum estimated tokens in conversational messages. */
  readonly tokens?: number;
}

/** A stateless recent-history policy resolved from a prompt `use` graph. */
export interface RecentHistoryProjection {
  /** Runtime discriminant used by prompt resolution. */
  readonly _tag: "HistoryRecent";
  /** Validated soft projection limits. */
  readonly limits: Readonly<RecentHistoryOptions>;
}

/**
 * Canonical history made available to one request.
 *
 * Thread integration binds this seam when canonical Thread lands. Until then,
 * caller-owned complete transcripts are the only source implementation.
 *
 * @internal
 */
export interface HistorySource {
  /** Safe source classification for diagnostics. */
  readonly kind: "caller-messages" | "thread";
  /** Complete canonical transcript in chronological order. */
  readonly messages: readonly Message[];
  /** Whether the supplied transcript already includes the current turn. */
  readonly mode: "manual" | "automatic";
  /** Current invocation messages appended after projection in automatic mode. */
  readonly current?: readonly Message[];
}

/** Redacted history facts carried into request planning. @internal */
export interface RequestHistoryContext {
  /** Safe source classification. */
  readonly source: "caller-messages" | "thread";
  /** Whether exact history or a recent projection entered the request. */
  readonly policy: "exact" | "recent";
  /** Boundary facts safe to attach to the executed request receipt. */
  readonly warnings: readonly RequestWarning[];
  /** Whether projection changed the canonical message sequence. */
  readonly changed: boolean;
}

/** Bind a caller-owned complete transcript to the history seam. @internal */
export function callerOwnedHistorySource(
  messages: readonly Message[],
): HistorySource {
  return Object.freeze({
    kind: "caller-messages",
    messages: Object.freeze([...messages]),
    mode: "manual",
  });
}
