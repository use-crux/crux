import type { IndexPatchFacts } from "../patches";

/**
 * Fact groups in their canonical V3 declaration order.
 *
 * The order is part of the cross-language worker contract. Producers derive
 * presence from the original patch, while consumers use the same list to
 * reject unknown, duplicate, or reordered declarations.
 */
export const projectIndexFactGroups = [
  "prompts",
  "contexts",
  "tools",
  "lint",
  "definitions",
  "relations",
  "sourceRefs",
  "diagnostics",
  "lintFindings",
  "ruleDescriptors",
  "sources",
  "sourceGraph",
] as const satisfies readonly (keyof IndexPatchFacts)[];

/** One fact group declared by a V3 phase summary. */
export type ProjectIndexFactGroup = (typeof projectIndexFactGroups)[number];

/** Mutable reconstruction target for the otherwise readonly patch contract. */
export type MutableIndexPatchFacts = {
  -readonly [TKey in keyof IndexPatchFacts]: IndexPatchFacts[TKey];
};

interface FactEnvelopePresence {
  readonly kind: unknown;
}

interface PhaseSummaryPresence {
  readonly factCount: unknown;
  readonly factGroups?: unknown;
}

const singletonFactGroups = new Set<ProjectIndexFactGroup>([
  "lint",
  "sourceGraph",
]);

/**
 * Returns the defined own fact properties that a new producer must declare.
 *
 * Runtime validation happens before the first event is yielded, preventing a
 * malformed patch from producing a partial transaction.
 */
export function factGroupsFromPatchFacts(
  facts: IndexPatchFacts,
): readonly ProjectIndexFactGroup[] {
  const groups: ProjectIndexFactGroup[] = [];
  for (const group of projectIndexFactGroups) {
    if (!Object.prototype.hasOwnProperty.call(facts, group)) continue;
    const value = facts[group];
    if (value === undefined) continue;
    validateProducerFactGroup(group, value);
    groups.push(group);
  }
  return groups;
}

/**
 * Validates one terminal declaration against all streamed envelopes.
 *
 * Validation completes before reconstruction starts. Declared array groups
 * are initialized as own empty arrays so an explicit clear cannot collapse
 * into legacy omission.
 */
export function prepareFactGroupReconstruction(
  summary: PhaseSummaryPresence,
  envelopes: readonly FactEnvelopePresence[],
): MutableIndexPatchFacts {
  if (
    typeof summary.factCount !== "number" ||
    !Number.isSafeInteger(summary.factCount) ||
    summary.factCount < 0
  ) {
    throw new Error(
      "phase:done summary factCount must be a nonnegative integer",
    );
  }
  if (summary.factCount !== envelopes.length) {
    throw new Error(
      `phase:done summary factCount = ${summary.factCount}, want ${envelopes.length}`,
    );
  }

  const declared = decodeFactGroups(summary.factGroups);
  if (declared === undefined) return {};

  const declaredSet = new Set(declared);
  const counts = new Map<ProjectIndexFactGroup, number>();
  for (const envelope of envelopes) {
    const group = factGroup(envelope.kind);
    if (!group || !declaredSet.has(group)) {
      throw new Error(
        `worker envelope kind ${String(envelope.kind)} is undeclared`,
      );
    }
    counts.set(group, (counts.get(group) ?? 0) + 1);
  }
  for (const group of declared) {
    if (singletonFactGroups.has(group) && counts.get(group) !== 1) {
      throw new Error(
        `worker singleton fact group ${group} must emit exactly one fact`,
      );
    }
  }

  return initializeDeclaredArrays(declared);
}

function decodeFactGroups(
  value: unknown,
): readonly ProjectIndexFactGroup[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new Error("phase:done summary factGroups must be an array");
  }

  const groups: ProjectIndexFactGroup[] = [];
  let previous = -1;
  for (const candidate of value) {
    const group = factGroup(candidate);
    const position = group ? projectIndexFactGroups.indexOf(group) : -1;
    if (!group || position <= previous) {
      throw new Error(
        "phase:done summary factGroups must use canonical unique groups",
      );
    }
    groups.push(group);
    previous = position;
  }
  return groups;
}

function initializeDeclaredArrays(
  groups: readonly ProjectIndexFactGroup[],
): MutableIndexPatchFacts {
  const facts: MutableIndexPatchFacts = {};
  for (const group of groups) {
    switch (group) {
      case "prompts":
        facts.prompts = [];
        break;
      case "contexts":
        facts.contexts = [];
        break;
      case "tools":
        facts.tools = [];
        break;
      case "definitions":
        facts.definitions = [];
        break;
      case "relations":
        facts.relations = [];
        break;
      case "sourceRefs":
        facts.sourceRefs = [];
        break;
      case "diagnostics":
        facts.diagnostics = [];
        break;
      case "lintFindings":
        facts.lintFindings = [];
        break;
      case "ruleDescriptors":
        facts.ruleDescriptors = [];
        break;
      case "sources":
        facts.sources = [];
        break;
      case "lint":
      case "sourceGraph":
        break;
    }
  }
  return facts;
}

function validateProducerFactGroup(
  group: ProjectIndexFactGroup,
  value: unknown,
): void {
  if (value === null) {
    throw new Error(`patch fact group ${group} cannot be null`);
  }
  const singleton = singletonFactGroups.has(group);
  if (singleton === Array.isArray(value)) {
    const shape = singleton ? "a singleton" : "an array";
    throw new Error(`patch fact group ${group} must be ${shape}`);
  }
}

function factGroup(value: unknown): ProjectIndexFactGroup | undefined {
  switch (value) {
    case "prompts":
    case "contexts":
    case "tools":
    case "lint":
    case "definitions":
    case "relations":
    case "sourceRefs":
    case "diagnostics":
    case "lintFindings":
    case "ruleDescriptors":
    case "sources":
    case "sourceGraph":
      return value;
    default:
      return undefined;
  }
}
