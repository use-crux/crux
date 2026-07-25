import type { IndexPatchFacts } from "../../../../patches";
import type { NativeDefinition } from "./types";

/** Zips definitions with complete evidence, failing closed on any missing value. */
export function zipDefinitions<TValue>(
  definitions: readonly NativeDefinition[],
  values: readonly (TValue | undefined)[],
):
  | readonly { readonly definition: NativeDefinition; readonly value: TValue }[]
  | undefined {
  if (definitions.length !== values.length) return undefined;
  const pairs = definitions.map((definition, index) => {
    const value = values[index];
    return value ? { definition, value } : undefined;
  });
  return presentValues(pairs);
}

/** Returns a complete immutable list, or fails when any projected value is absent. */
export function presentValues<TValue>(
  values: readonly (TValue | undefined)[],
): readonly TValue[] | undefined {
  return values.every((value): value is TValue => value !== undefined)
    ? values
    : undefined;
}

/** Merges file-local direct evidence into one deterministic Project Index patch. */
export function mergeNativeDirectFacts(
  facts: readonly IndexPatchFacts[],
): IndexPatchFacts {
  return {
    definitions: facts.flatMap((entry) => entry.definitions ?? []),
    relations: facts.flatMap((entry) => entry.relations ?? []),
    sourceRefs: facts.flatMap((entry) => entry.sourceRefs ?? []),
    diagnostics: facts.flatMap((entry) => entry.diagnostics ?? []),
  };
}
