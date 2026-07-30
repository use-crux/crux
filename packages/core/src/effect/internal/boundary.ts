/**
 * Effect rollback-boundary creation.
 *
 * @internal
 * @module
 */

import type { EffectScopeRef } from "../types";

let nextImplicitBoundaryId = 0;

/** Create the one-operation root boundary used by a standalone effect call. */
export function createImplicitRootBoundary(): EffectScopeRef {
  const id = `effect-root:${++nextImplicitBoundaryId}`;
  return Object.freeze({
    kind: "effect.scope",
    id,
    runId: id,
  });
}
