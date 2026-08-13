/** Work policy contributions: validated, immutable resource limits. */

/**
 * Tree-shaped fan-out limits for a Work policy.
 *
 * Bounds the branching Work tree: how deep a lineage may nest and how many
 * child Work occurrences a single node may start or keep active. Every limit
 * is optional at authoring time; an authored policy contains only the limits
 * the author declared.
 */
export interface WorkTreePolicy {
  /** Maximum nesting depth of the Work tree, counting from the root. */
  readonly maxDepth?: number;
  /** Maximum child Work occurrences a single node may start. */
  readonly maxStarts?: number;
  /** Maximum simultaneously active child Work occurrences per node. */
  readonly maxActive?: number;
}

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
          ? { maxDepth: requirePositiveSafeInteger(tree.maxDepth, "tree.maxDepth") }
          : {}),
        ...(tree.maxStarts !== undefined
          ? { maxStarts: requirePositiveSafeInteger(tree.maxStarts, "tree.maxStarts") }
          : {}),
        ...(tree.maxActive !== undefined
          ? { maxActive: requirePositiveSafeInteger(tree.maxActive, "tree.maxActive") }
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
    throw new RangeError(`workPolicy(): ${field} must be a positive safe integer.`);
  }
  return value;
}
