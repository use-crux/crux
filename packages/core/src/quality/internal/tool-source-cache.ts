/**
 * Conservative output-cache eligibility for authored tool sources.
 *
 * This inspection is intentionally static and side-effect free. It walks every
 * declared prompt/context branch without evaluating predicates or connecting
 * to a source. An unmarked source is live; only an explicit stable fixture
 * identity can remain output-cache eligible.
 *
 * @internal
 * @module
 */

import { TARGET_INTERNAL, type TargetInternal } from "../target";
import {
  isToolSource,
  toolSourceQualityIdentity,
} from "../../tools/tool-source";

export type OutputCacheBypassReason = "live-tool-source";

/** Return the reason reusable cell outputs are unsafe for this task. */
export function taskOutputCacheBypassReason(
  task: unknown,
): OutputCacheBypassReason | undefined {
  return mayContainLiveToolSource(task, new Set())
    ? "live-tool-source"
    : undefined;
}

/** Return canonically ordered fixture revisions that participate in cache identity. */
export function taskToolSourceFixtureIdentities(
  task: unknown,
): readonly string[] {
  const identities = new Set<string>();
  collectFixtureIdentities(task, new Set(), identities);
  return [...identities].sort();
}

function mayContainLiveToolSource(value: unknown, seen: Set<object>): boolean {
  if (isToolSource(value)) {
    return toolSourceQualityIdentity(value)?.kind !== "fixture";
  }
  if (value === null || typeof value !== "object" || seen.has(value)) {
    return false;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.some((entry) => mayContainLiveToolSource(entry, seen));
  }

  const tagged = value as { readonly _tag?: unknown };
  switch (tagged._tag) {
    case "Prompt":
      return visitProperties(value, ["contexts", "config"], seen);
    case "Context":
      return visitProperties(value, ["useEntries"], seen);
    case "ConditionalContext":
      return visitProperties(value, ["context"], seen);
    case "MatchSpec":
      return visitMatchBranches(value, seen);
    case "Contributor":
      return visitProperties(value, ["useEntries"], seen);
    case "Agent":
      return visitProperties(value, ["prompt"], seen);
    case "QualityTarget": {
      const internal = (
        value as { readonly [TARGET_INTERNAL]?: TargetInternal }
      )[TARGET_INTERNAL];
      return mayContainLiveToolSource(internal?.primitive, seen);
    }
    default:
      return false;
  }
}

function visitMatchBranches(value: object, seen: Set<object>): boolean {
  const match = value as {
    readonly cases?: Readonly<Record<string, unknown>>;
    readonly default?: unknown;
  };
  return (
    Object.values(match.cases ?? {}).some((branch) =>
      mayContainLiveToolSource(branch, seen),
    ) || mayContainLiveToolSource(match.default, seen)
  );
}

function visitProperties(
  value: object,
  keys: readonly string[],
  seen: Set<object>,
): boolean {
  const record = value as Readonly<Record<string, unknown>>;
  return keys.some((key) => mayContainLiveToolSource(record[key], seen));
}

function collectFixtureIdentities(
  value: unknown,
  seen: Set<object>,
  identities: Set<string>,
): void {
  if (isToolSource(value)) {
    const identity = toolSourceQualityIdentity(value);
    if (identity?.kind === "fixture") identities.add(identity.id);
    return;
  }
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const entry of value)
      collectFixtureIdentities(entry, seen, identities);
    return;
  }

  const tagged = value as { readonly _tag?: unknown };
  switch (tagged._tag) {
    case "Prompt":
      collectProperties(value, ["contexts", "config"], seen, identities);
      break;
    case "Context":
      collectProperties(value, ["useEntries"], seen, identities);
      break;
    case "ConditionalContext":
      collectProperties(value, ["context"], seen, identities);
      break;
    case "MatchSpec": {
      const match = value as {
        readonly cases?: Readonly<Record<string, unknown>>;
        readonly default?: unknown;
      };
      collectFixtureIdentities(
        Object.values(match.cases ?? {}),
        seen,
        identities,
      );
      collectFixtureIdentities(match.default, seen, identities);
      break;
    }
    case "Contributor":
      collectProperties(value, ["useEntries"], seen, identities);
      break;
    case "Agent":
      collectProperties(value, ["prompt"], seen, identities);
      break;
    case "QualityTarget": {
      const internal = (
        value as { readonly [TARGET_INTERNAL]?: TargetInternal }
      )[TARGET_INTERNAL];
      collectFixtureIdentities(internal?.primitive, seen, identities);
      break;
    }
  }
}

function collectProperties(
  value: object,
  keys: readonly string[],
  seen: Set<object>,
  identities: Set<string>,
): void {
  const record = value as Readonly<Record<string, unknown>>;
  for (const key of keys) {
    collectFixtureIdentities(record[key], seen, identities);
  }
}
