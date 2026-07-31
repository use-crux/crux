/**
 * Redacted token breakdowns for request receipts and inspection.
 *
 * @module
 */

/** Tokens attributed to one safe contribution class. */
export interface RequestTokenBreakdownEntry {
  /** Safe contribution class; authored content is never retained. */
  readonly contributor: string;
  /** Estimated or counted input tokens for the class. */
  readonly tokens: number;
}

/** Redacted complete-request token breakdown. */
export interface RequestTokenBreakdown {
  /** Total measured input tokens. */
  readonly total: number;
  /** Confidence of the per-class attribution, independent from total count. */
  readonly attribution: "estimated";
  /** Largest-first estimated contribution-class totals. */
  readonly contributions: readonly RequestTokenBreakdownEntry[];
}

/** Create a frozen, largest-first redacted token breakdown. @internal */
export function tokenBreakdown(
  entries: readonly RequestTokenBreakdownEntry[],
): RequestTokenBreakdown {
  const contributions = entries
    .filter((entry) => entry.tokens > 0)
    .map((entry) => Object.freeze({ ...entry }))
    .sort((left, right) => right.tokens - left.tokens);
  return Object.freeze({
    total: contributions.reduce((sum, entry) => sum + entry.tokens, 0),
    attribution: "estimated",
    contributions: Object.freeze(contributions),
  });
}

/** Replace the measured total while retaining explicitly estimated attribution. @internal */
export function withTokenBreakdownTotal(
  breakdown: RequestTokenBreakdown,
  total: number,
): RequestTokenBreakdown {
  if (total === breakdown.total) return breakdown;
  return Object.freeze({ ...breakdown, total });
}
