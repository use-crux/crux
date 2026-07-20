import { createAsyncScopeFacet } from "../async-scope";
import type { ScopeFacetSlot } from "./facets";

interface ScopeFacetOverrideFrame {
  readonly parent: ScopeFacetOverrideFrame | undefined;
  readonly slot: object;
  readonly value: unknown;
}

const scopeFacetOverrides = createAsyncScopeFacet<ScopeFacetOverrideFrame>(
  "core.scope-facet-overrides",
);

/**
 * Run one execution branch with an immutable facet override.
 *
 * Overrides live on Core's canonical carrier, so they propagate across awaits
 * and captured frames when AsyncLocalStorage is available while retaining the
 * carrier's synchronous-only fallback semantics.
 */
export function runWithScopeFacet<T, R>(
  slot: ScopeFacetSlot<T>,
  value: T,
  fn: () => R,
): R {
  return scopeFacetOverrides.run(
    Object.freeze({
      parent: scopeFacetOverrides.current(),
      slot,
      value,
    }),
    fn,
  );
}

/** Return the nearest execution-local override for a slot. @internal */
export function currentScopeFacetOverride<T>(
  slot: ScopeFacetSlot<T>,
): { readonly found: true; readonly value: T } | { readonly found: false } {
  let frame = scopeFacetOverrides.current();
  while (frame) {
    if (frame.slot === slot) return { found: true, value: frame.value as T };
    frame = frame.parent;
  }
  return { found: false };
}
