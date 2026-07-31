/**
 * Monotonic representation floors within one concrete-model epoch.
 *
 * @module
 */

import type { InputBudget } from "../budget/input-budget";

/** Mutable execution-local state; sealed requests remain immutable. @internal */
export interface RequestRepresentationEpoch {
  key: string | undefined;
  readonly floors: Map<string, number>;
}

/** Create empty representation stability state for one managed execution. @internal */
export function createRequestRepresentationEpoch(): RequestRepresentationEpoch {
  return { key: undefined, floors: new Map() };
}

/** Reset floors only when concrete model or explicit budget identity changes. @internal */
export function representationFloors(
  epoch: RequestRepresentationEpoch,
  provider: string,
  model: string,
  inputBudget: InputBudget | undefined,
): ReadonlyMap<string, number> {
  const key = `${provider}:${model}:${JSON.stringify(inputBudget ?? {})}`;
  if (epoch.key !== key) {
    epoch.key = key;
    epoch.floors.clear();
  }
  return epoch.floors;
}

/** Raise floors after selection so later calls cannot re-expand. @internal */
export function recordRepresentationSelection(
  epoch: RequestRepresentationEpoch,
  selections: ReadonlyMap<string, number>,
): void {
  for (const [contributor, rung] of selections) {
    epoch.floors.set(
      contributor,
      Math.max(epoch.floors.get(contributor) ?? 0, rung),
    );
  }
}
