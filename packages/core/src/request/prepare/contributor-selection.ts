/**
 * Identity-safe contributor selection for preparation amendments.
 *
 * @internal
 * @module
 */

import type { ContextEntry } from "../../prompt/context-types";
import { RequestCompositionError } from "../errors";
import {
  isRepresentationLadder,
  representationSources,
} from "../representation/ladder";
import type {
  ContributorSelector,
  ExecutionAmendment,
} from "./amendment";

/** Apply one boundary-local top-level contributor delta. @internal */
export function applyUseAmendment(
  baseline: readonly ContextEntry[],
  amendment: ExecutionAmendment["use"],
): readonly ContextEntry[] {
  if (!amendment?.add?.length && !amendment?.remove?.length) return baseline;
  const additions = [...(amendment.add ?? [])];
  for (const entry of additions) assertAmendableEntry(entry);
  const removed = new Set<ContextEntry>();
  for (const selector of amendment.remove ?? []) {
    const matches = selectEntries(baseline, selector);
    for (const entry of matches) {
      assertRemovableEntry(entry);
      removed.add(entry);
    }
  }
  if (
    additions.some((addition) =>
      [...removed].some((entry) => sameContributorIdentity(addition, entry)),
    )
  ) {
    throw invalidAmendment(
      "One amendment cannot add and remove the same contributor identity.",
    );
  }
  const seen = new Set<ContextEntry>();
  return Object.freeze([
    ...baseline.filter((entry) => !removed.has(entry)),
    ...additions.filter((entry) => {
      if (seen.has(entry) || baseline.includes(entry)) return false;
      seen.add(entry);
      return true;
    }),
  ]);
}

function sameContributorIdentity(
  left: ContextEntry,
  right: ContextEntry,
): boolean {
  if (left === right) return true;
  return (
    !!left &&
    !!right &&
    typeof left === "object" &&
    typeof right === "object" &&
    "id" in left &&
    "id" in right &&
    typeof left.id === "string" &&
    left.id === right.id
  );
}

function selectEntries(
  entries: readonly ContextEntry[],
  selector: ContributorSelector,
): readonly ContextEntry[] {
  if (entries.includes(selector as ContextEntry)) {
    return [selector as ContextEntry];
  }
  if (!selector || typeof selector !== "object" || !("id" in selector)) {
    return [];
  }
  const matches = entries.filter(
    (entry) =>
      !!entry &&
      typeof entry === "object" &&
      "id" in entry &&
      entry.id === selector.id,
  );
  if (matches.length > 1) {
    throw invalidAmendment(
      "Contributor ids selected by preparation must be unique in the resolved graph.",
    );
  }
  if (matches.length === 0 && selectsNestedEntry(entries, selector)) {
    throw invalidAmendment(
      "Preparation must remove a top-level contributor identity, not a nested representation or atomic member.",
    );
  }
  return matches;
}

function selectsNestedEntry(
  entries: readonly ContextEntry[],
  selector: ContributorSelector,
): boolean {
  const nested: ContextEntry[] = [];
  for (const entry of entries) collectChildren(entry, nested);
  return nested.some((entry) => {
    if (entry === selector) return true;
    return (
      !!entry &&
      typeof entry === "object" &&
      "id" in entry &&
      "id" in selector &&
      entry.id === selector.id
    );
  });
}

function collectChildren(
  entry: ContextEntry,
  out: ContextEntry[],
  seen = new Set<object>(),
): void {
  if (!entry || typeof entry !== "object" || seen.has(entry)) return;
  seen.add(entry);
  for (const child of directChildren(entry)) {
    out.push(child);
    collectChildren(child, out, seen);
  }
}

function directChildren(entry: ContextEntry): readonly ContextEntry[] {
  if (!entry || typeof entry !== "object") return [];
  let children: readonly ContextEntry[] = [];
  if (entry._tag === "ConditionalContext" && "context" in entry) {
    children = [entry.context];
  } else if (entry._tag === "MatchSpec" && "cases" in entry) {
    const fallback = "default" in entry ? entry.default : undefined;
    children = [
      ...Object.values(entry.cases).flatMap((branch) =>
        Array.isArray(branch) ? branch : [branch],
      ),
      ...(fallback
        ? Array.isArray(fallback)
          ? fallback
          : [fallback]
        : []),
    ];
  } else if (
    (entry._tag === "Context" || entry._tag === "Contributor") &&
    "useEntries" in entry
  ) {
    children = entry.useEntries;
  } else if (isRepresentationLadder(entry)) {
    children = representationSources(entry);
  }
  return children;
}

function assertAmendableEntry(entry: ContextEntry): void {
  const tag =
    entry && typeof entry === "object" && "_tag" in entry
      ? entry._tag
      : undefined;
  if (
    tag === "Memory" ||
    tag === "HistoryRecent" ||
    tag === "HistoryManaged"
  ) {
    throw invalidAmendment(
      "Preparation cannot change transcript or history ownership.",
    );
  }
}

function assertRemovableEntry(entry: ContextEntry): void {
  assertAmendableEntry(entry);
  if (hasProtectedCapabilities(entry)) {
    throw invalidAmendment(
      "Preparation cannot remove protected Safety or approval contracts unless their complete contributor is droppable.",
    );
  }
}

function hasProtectedCapabilities(
  entry: ContextEntry,
  seen = new Set<object>(),
): boolean {
  if (!entry || typeof entry !== "object") return false;
  if (seen.has(entry)) return false;
  seen.add(entry);
  if (entry._tag === "droppable") return false;
  if (entry._tag === "WorkPolicy") {
    return true;
  }
  if (
    entry._tag === "Context" &&
    "constraints" in entry &&
    "guardrails" in entry &&
    (entry.constraints.length > 0 ||
      entry.guardrails.length > 0 ||
      ("toolApproval" in entry &&
        !!entry.toolApproval &&
        Object.keys(entry.toolApproval).length > 0))
  ) {
    return true;
  }
  return directChildren(entry).some((child) =>
    hasProtectedCapabilities(child, seen),
  );
}

/** Create one safe composition failure for an invalid delta. @internal */
export function invalidAmendment(message: string): RequestCompositionError {
  const requestId = "request_preparation_composition";
  return new RequestCompositionError(
    "INVALID_COMPOSITION",
    message,
    [
      {
        id: `${requestId}:amendment`,
        code: "INVALID_EXECUTION_AMENDMENT",
        contributor: "prepareStep",
        message,
      },
    ],
    requestId,
  );
}
