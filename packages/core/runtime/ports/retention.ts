/**
 * Runtime retention port contracts.
 *
 * Retention pruning is intentionally dumb at the adapter boundary: callers
 * compute cutoffs, adapters delete a bounded batch of already-terminal records,
 * and policy remains in the Runtime Engine kernel.
 *
 * @module
 */

/** Options shared by store ports that support bounded retention pruning. */
export interface RuntimePruneOptions {
  /** Namespace to prune. Omit only for maintenance-wide sweeps. */
  readonly namespace?: string
  /** Delete records whose terminal or settled timestamp is before this cutoff. */
  readonly before: Date
  /** Maximum number of eligible records to delete. Adapters must respect it. */
  readonly limit: number
}

/** Result returned by one bounded retention prune call. */
export interface RuntimePruneResult {
  /** Number of records removed by this pass. */
  readonly removed: number
  /** True when more eligible records remain after this bounded pass. */
  readonly truncated: boolean
}
