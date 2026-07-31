/**
 * Provider-neutral history ownership used by request projection.
 *
 * @module
 */

import type { Message } from "../../generation/messages";
import type { RequestWarning } from "../receipt/adaptations";
import type { SummarizeStrategy } from "./strategies";

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

/** Options controlling the exact suffix retained by {@link history}. */
export type ManagedHistoryRecent =
  | number
  | Readonly<RecentHistoryOptions>;

/** Configuration for a managed history summary representation. */
export interface ManagedHistorySummaryOptions {
  /** Optional summary model; defaults to the resolved response model. */
  readonly model?: unknown;
  /** Summary algorithm; defaults to {@link summarize.adaptive}. */
  readonly strategy?: SummarizeStrategy;
}

/** Options accepted by the managed {@link history} projection. */
export interface HistoryOptions {
  /** Exact recent suffix, derived from the request budget when omitted. */
  readonly recent?: ManagedHistoryRecent;
  /** Model and strategy used to prepare derived summary artifacts. */
  readonly summary?: Readonly<ManagedHistorySummaryOptions>;
  /** Behavior when a required summary artifact is unavailable. */
  readonly onMiss?: "inline" | "recent-only" | "fail";
  /** Allow a provider-native summary path when the adapter supports one. */
  readonly providerNative?: boolean;
}

/** A managed summary-prefix plus exact-suffix history projection. */
export interface ManagedHistoryProjection {
  /** Runtime discriminant used by prompt resolution. */
  readonly _tag: "HistoryManaged";
  /** Validated and defaulted managed-history policy. */
  readonly options: Readonly<{
    readonly recent?: ManagedHistoryRecent;
    readonly summary: Readonly<ManagedHistorySummaryOptions> & {
      readonly strategy: SummarizeStrategy;
    };
    readonly onMiss: "inline" | "recent-only" | "fail";
    readonly providerNative: boolean;
  }>;
}

/** Any history projection accepted by prompt composition. */
export type HistoryProjection =
  | RecentHistoryProjection
  | ManagedHistoryProjection;

/** Input supplied to an adapter's optional history-compaction lowering port. */
export interface ProviderHistorySummaryInput {
  /** Exact canonical prefix to summarize. */
  readonly messages: readonly Message[];
  /** Concrete summary model reference selected for the support call. */
  readonly model: unknown;
  /** Versioned strategy selected by the managed-history policy. */
  readonly strategy: SummarizeStrategy;
  /** Whether the provider may use its native compaction facility. */
  readonly providerNative: boolean;
}

/** Result returned by an adapter history-compaction lowering port. */
export interface ProviderHistorySummaryResult {
  /** Derived summary text; canonical messages remain untouched. */
  readonly summary: string;
  /** Optional linked support-request identity from the adapter. */
  readonly requestId?: string;
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
  /** Whether exact, recent, or managed history entered request planning. */
  readonly policy: "exact" | "recent" | "managed";
  /** Managed policy retained until the concrete request budget is known. */
  readonly projection?: ManagedHistoryProjection;
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
