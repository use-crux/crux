const facetSlotBrand: unique symbol = Symbol("core.scope-facet-slot.brand");
const facetSlotKeys = new WeakMap<object, symbol>();
const registeredFacetNames = new Set<string>();

/** Opaque key for one typed value attached to an execution scope. */
export interface ScopeFacetSlot<T> {
  readonly debugName: string;
  readonly [facetSlotBrand]: (value: T) => T;
}

/**
 * Create an isolated typed slot for a first-party execution-scope facet.
 *
 * Slots are nominal and may only be constructed through this function. Values
 * are resolved by walking from the current scope to its ancestors.
 *
 * @param debugName - Stable diagnostics-only name for the owning subsystem.
 */
export function createScopeFacetSlot<T>(debugName: string): ScopeFacetSlot<T> {
  const slot = Object.freeze({ debugName }) as ScopeFacetSlot<T>;
  facetSlotKeys.set(slot, Symbol(debugName));
  registeredFacetNames.add(debugName);
  return slot;
}

/** Return the runtime key for a slot created by {@link createScopeFacetSlot}. @internal */
export function scopeFacetSlotKey<T>(slot: ScopeFacetSlot<T>): symbol {
  const key = facetSlotKeys.get(slot);
  if (!key)
    throw new TypeError(
      "Scope facet slots must be created with createScopeFacetSlot().",
    );
  return key;
}

/** Return stable diagnostics names for registered scope facets. @internal */
export function registeredScopeFacetSlotsForTesting(): readonly string[] {
  return [...registeredFacetNames].sort();
}
