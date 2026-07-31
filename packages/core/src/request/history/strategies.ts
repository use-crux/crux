/**
 * Public managed-history summary strategy constructors.
 *
 * @module
 */

/** Stable first-party managed-history summary strategy identity. */
export interface SummarizeStrategy {
  /** Runtime discriminant used by artifact identity and preparation. */
  readonly _tag: "SummarizeStrategy";
  /** Versioned first-party strategy name. */
  readonly kind:
    | "adaptive"
    | "regenerate"
    | "rolling"
    | "hierarchical";
  /** Strategy contract version included in content-addressed identity. */
  readonly version: 1;
}

/** Constructors for versioned first-party summary strategies. */
export interface SummarizeFactory {
  /**
   * Select the versioned default strategy.
   *
   * Adaptive summaries use bounded hierarchical work and may regenerate from
   * canonical truth. Construction performs no model call or persistence.
   *
   * @returns An inert adaptive strategy value.
   *
   * @example
   * ```ts
   * history({ summary: { strategy: summarize.adaptive() } })
   * ```
   */
  adaptive(): SummarizeStrategy;

  /**
   * Regenerate each artifact directly from its canonical prefix.
   *
   * @returns An inert regeneration strategy value.
   */
  regenerate(): SummarizeStrategy;

  /**
   * Extend summaries from deterministic canonical ranges.
   *
   * @returns An inert rolling strategy value.
   */
  rolling(): SummarizeStrategy;

  /**
   * Summarize deterministic ranges through a bounded hierarchy.
   *
   * @returns An inert hierarchical strategy value.
   */
  hierarchical(): SummarizeStrategy;
}

function strategy(kind: SummarizeStrategy["kind"]): SummarizeStrategy {
  return Object.freeze({
    _tag: "SummarizeStrategy" as const,
    kind,
    version: 1 as const,
  });
}

/** Create inert first-party managed-history summary strategies. */
export const summarize: SummarizeFactory = Object.freeze({
  adaptive: () => strategy("adaptive"),
  regenerate: () => strategy("regenerate"),
  rolling: () => strategy("rolling"),
  hierarchical: () => strategy("hierarchical"),
});
