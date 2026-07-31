/**
 * Public managed-history construction and validation.
 *
 * @module
 */

import {
  createRecentHistoryProjection,
} from "./recent";
import {
  type HistoryOptions,
  type ManagedHistoryProjection,
  type RecentHistoryOptions,
  type RecentHistoryProjection,
} from "./source";
import { summarize } from "./strategies";

/** Public factory surface for exact and managed request history policies. */
export interface HistoryFactory {
  /**
   * Authorize summary-prefix plus exact-suffix history management.
   *
   * Construction is inert: it never mutates canonical messages, calls a
   * model, writes an artifact, or schedules maintenance. Those actions occur
   * only at a concrete provider-request boundary.
   *
   * @param options - Local suffix, summary, miss, and native-path policy.
   * @returns An inert managed-history entry for a prompt's `use` array.
   *
   * @example
   * ```ts
   * const reply = prompt({
   *   use: [history({ recent: 20, onMiss: "inline" })],
   *   prompt: "Reply to the conversation.",
   * })
   * ```
   */
  (options?: Readonly<HistoryOptions>): ManagedHistoryProjection;

  /**
   * Select the newest causal-group-safe suffix of a complete transcript.
   *
   * This policy is stateless and never prepares summary artifacts.
   *
   * @param limit - Message cap, or message/token caps.
   * @returns An inert recent-history entry for a prompt's `use` array.
   */
  recent(
    limit?: number | Readonly<RecentHistoryOptions>,
  ): RecentHistoryProjection;
}

function managedHistory(
  options: Readonly<HistoryOptions> = {},
): ManagedHistoryProjection {
  let recent: HistoryOptions["recent"];
  if (options.recent !== undefined) {
    const validated = createRecentHistoryProjection(options.recent);
    recent =
      typeof options.recent === "number"
        ? options.recent
        : validated.limits;
  }
  const strategy = options.summary?.strategy ?? summarize.adaptive();
  if (
    strategy._tag !== "SummarizeStrategy" ||
    strategy.version !== 1
  ) {
    throw new TypeError(
      "history() summary.strategy must be created by summarize.",
    );
  }
  const onMiss = options.onMiss ?? "inline";
  if (
    onMiss !== "inline" &&
    onMiss !== "recent-only" &&
    onMiss !== "fail"
  ) {
    throw new TypeError(
      "history() onMiss must be inline, recent-only, or fail.",
    );
  }
  return Object.freeze({
    _tag: "HistoryManaged" as const,
    options: Object.freeze({
      ...(recent !== undefined ? { recent } : {}),
      summary: Object.freeze({
        ...(options.summary?.model !== undefined
          ? { model: options.summary.model }
          : {}),
        strategy,
      }),
      onMiss,
      providerNative: options.providerNative ?? true,
    }),
  });
}

/** Create provider-neutral exact-suffix and managed history policies. */
export const history: HistoryFactory = Object.assign(managedHistory, {
  recent: createRecentHistoryProjection,
});
