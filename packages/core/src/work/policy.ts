/** Work policy contributions: validated, immutable resource limits. */

/**
 * Tree-shaped fan-out limits for a Work policy.
 *
 * Bounds the branching Work tree: how deep a lineage may nest and how many
 * Agent descendants a root may accept over its lifetime or keep active
 * simultaneously. Every limit is optional at authoring time; an authored
 * policy contains only the limits the author declared.
 */
export interface WorkTreePolicy {
  /** Maximum nesting depth of the Work tree, counting depth from the root at zero. */
  readonly maxDepth?: number;
  /** Lifetime accepted Agent descendants across one root. */
  readonly maxStarts?: number;
  /** Simultaneous nonterminal Agent descendants, root-wide. */
  readonly maxActive?: number;
}

/**
 * Finite effective Work limits applied by a process-local host.
 *
 * Every limit is resolved to a positive safe integer. The values in the
 * resolved policy are the strictest intersection of all contributed policies
 * (host, target, and default), so no authoring contribution can exceed the
 * implementation defaults and concurrent contributions only tighten limits.
 */
export interface ResolvedWorkPolicy {
  /** Maximum concurrently executing Work occurrences. */
  readonly concurrency: number;
  /** Maximum queued-plus-active Work occurrences awaiting a concurrency slot. */
  readonly maxOutstanding: number;
  /** Finite tree-shaped fan-out limits. */
  readonly tree: {
    /** Maximum nesting depth of the Work tree, counting depth from the root at zero. */
    readonly maxDepth: number;
    /** Lifetime accepted Agent descendants across one root. */
    readonly maxStarts: number;
    /** Simultaneous nonterminal Agent descendants, root-wide. */
    readonly maxActive: number;
  };
}

/**
 * Implementation defaults for a process-local Work host.
 *
 * These are the finite ceiling every resolved policy intersects against: an
 * authored contribution may only narrow them, never widen them. Limits are
 * provisionally `concurrency 8`, `maxOutstanding 32`, and tree
 * `maxDepth 4` / `maxStarts 64` / `maxActive 16`.
 */
export const DEFAULT_WORK_POLICY: ResolvedWorkPolicy = Object.freeze({
  concurrency: 8,
  maxOutstanding: 32,
  tree: Object.freeze({
    maxDepth: 4,
    maxStarts: 64,
    maxActive: 16,
  }),
});

/** Authoring options accepted by {@link workPolicy}. */
export interface WorkPolicyOptions {
  /** Maximum concurrently executing Work occurrences. */
  readonly concurrency?: number;
  /** Maximum queued-plus-active Work occurrences awaiting a concurrency slot. */
  readonly maxOutstanding?: number;
  /** Tree-shaped fan-out limits. */
  readonly tree?: WorkTreePolicy;
}

/**
 * Normalized, deeply frozen Work policy contribution.
 *
 * Contains only the values the author supplied — limits that were omitted are
 * absent, not defaulted, so multiple contributions can be merged by
 * minimum/intersection at prompt resolution.
 */
export interface WorkPolicy {
  /** Discriminant identifying this contribution as a Work policy in `use` composition. */
  readonly _tag: "WorkPolicy";
  /** Maximum concurrently executing Work occurrences. */
  readonly concurrency?: number;
  /** Maximum queued-plus-active Work occurrences awaiting a concurrency slot. */
  readonly maxOutstanding?: number;
  /** Tree-shaped fan-out limits. */
  readonly tree?: WorkTreePolicy;
}

/**
 * Create a Work policy contribution describing resource limits.
 *
 * Every authored count must be a positive safe integer. The returned
 * contribution is deeply frozen and detached from the supplied options, so it
 * can be shared safely across hosts. It carries only the limits you authored;
 * omitted limits stay absent so resolution can merge contributions by the
 * strictest intersection.
 *
 * @param options - Authoring options for the policy.
 * @returns A deeply frozen {@link WorkPolicy} contribution.
 */
export function workPolicy(options: WorkPolicyOptions): WorkPolicy {
  const { concurrency, maxOutstanding, tree } = options;

  if (concurrency !== undefined) {
    requirePositiveSafeInteger(concurrency, "concurrency");
  }
  if (maxOutstanding !== undefined) {
    requirePositiveSafeInteger(maxOutstanding, "maxOutstanding");
  }

  const treeLimits = tree
    ? Object.freeze({
        ...(tree.maxDepth !== undefined
          ? {
              maxDepth: requirePositiveSafeInteger(
                tree.maxDepth,
                "tree.maxDepth",
              ),
            }
          : {}),
        ...(tree.maxStarts !== undefined
          ? {
              maxStarts: requirePositiveSafeInteger(
                tree.maxStarts,
                "tree.maxStarts",
              ),
            }
          : {}),
        ...(tree.maxActive !== undefined
          ? {
              maxActive: requirePositiveSafeInteger(
                tree.maxActive,
                "tree.maxActive",
              ),
            }
          : {}),
      })
    : undefined;

  return Object.freeze({
    _tag: "WorkPolicy" as const,
    ...(concurrency !== undefined ? { concurrency } : {}),
    ...(maxOutstanding !== undefined ? { maxOutstanding } : {}),
    ...(treeLimits !== undefined ? { tree: treeLimits } : {}),
  });
}

function requirePositiveSafeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(
      `workPolicy(): ${field} must be a positive safe integer.`,
    );
  }
  return value;
}

/**
 * Resolve zero or more Work policy contributions into finite effective limits.
 *
 * Every omitted limit falls back to the implementation default, and every
 * authored limit is intersected (minimum) with that default, so a contribution
 * can only tighten the effective ceiling. The result is deeply frozen and
 * detached from the contributions that produced it.
 *
 * @param contributions - Optional authored Work policy contributions.
 * @returns A deeply frozen {@link ResolvedWorkPolicy}.
 */
export function resolveWorkPolicy(
  ...contributions: Array<WorkPolicy | undefined>
): ResolvedWorkPolicy {
  let concurrency = DEFAULT_WORK_POLICY.concurrency;
  let maxOutstanding = DEFAULT_WORK_POLICY.maxOutstanding;
  let maxDepth = DEFAULT_WORK_POLICY.tree.maxDepth;
  let maxStarts = DEFAULT_WORK_POLICY.tree.maxStarts;
  let maxActive = DEFAULT_WORK_POLICY.tree.maxActive;

  for (const policy of contributions) {
    if (policy === undefined) {
      continue;
    }
    if (policy.concurrency !== undefined) {
      concurrency = Math.min(concurrency, policy.concurrency);
    }
    if (policy.maxOutstanding !== undefined) {
      maxOutstanding = Math.min(maxOutstanding, policy.maxOutstanding);
    }
    if (policy.tree?.maxDepth !== undefined) {
      maxDepth = Math.min(maxDepth, policy.tree.maxDepth);
    }
    if (policy.tree?.maxStarts !== undefined) {
      maxStarts = Math.min(maxStarts, policy.tree.maxStarts);
    }
    if (policy.tree?.maxActive !== undefined) {
      maxActive = Math.min(maxActive, policy.tree.maxActive);
    }
  }

  return Object.freeze({
    concurrency,
    maxOutstanding,
    tree: Object.freeze({
      maxDepth,
      maxStarts,
      maxActive,
    }),
  });
}

/**
 * Intersect two resolved policies by the strictest limit for every field.
 *
 * Used to combine a host/root policy with a target-resolved child policy so
 * concurrent contributions only tighten limits.
 *
 * @param left - First resolved policy.
 * @param right - Second resolved policy.
 * @returns A deeply frozen {@link ResolvedWorkPolicy} taking the minimum of
 *   every field from both inputs.
 */
export function intersectResolvedWorkPolicy(
  left: ResolvedWorkPolicy,
  right: ResolvedWorkPolicy,
): ResolvedWorkPolicy {
  return Object.freeze({
    concurrency: Math.min(left.concurrency, right.concurrency),
    maxOutstanding: Math.min(left.maxOutstanding, right.maxOutstanding),
    tree: Object.freeze({
      maxDepth: Math.min(left.tree.maxDepth, right.tree.maxDepth),
      maxStarts: Math.min(left.tree.maxStarts, right.tree.maxStarts),
      maxActive: Math.min(left.tree.maxActive, right.tree.maxActive),
    }),
  });
}
