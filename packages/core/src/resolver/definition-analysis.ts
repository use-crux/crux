/**
 * Definition-time analysis for statically reachable prompt entries.
 *
 * The resolver keeps value constructors effect-free, so facts discovered on
 * entries are validated or emitted when a prompt compiles. This module owns the
 * static walk used for prompt-level entry-id uniqueness and context definition
 * warnings.
 *
 * @module
 */

import type { z } from "zod";
import type {
  ConditionalContext,
  Context,
  ContextEntry,
  MatchSpec,
} from "../prompt/context-types";
import { isContributorEntry } from "../prompt/contributor";
import { isInternalInjectableEntry } from "../prompt/internal-injection";
import {
  compileRepresentationLadder,
  isForcedOffload,
  isRepresentationLadder,
  representationSources,
} from "../request/representation/ladder";
import type { DiagnosticsPort } from "./ports";

interface StaticEntryId {
  id: string;
}

/** Validate every statically reachable representation ladder. */
export function assertValidRepresentationLadders(
  entries: readonly ContextEntry[],
): void {
  for (const entry of entries) {
    if (!entry) continue;
    if (isForcedOffload(entry)) continue;
    if (isRepresentationLadder(entry)) {
      compileRepresentationLadder(entry);
      continue;
    }
    if (isContributorEntry(entry)) {
      assertValidRepresentationLadders(entry.useEntries);
      continue;
    }
    if (
      !isInternalInjectableEntry(entry) &&
      entry._tag === "Context"
    ) {
      assertValidRepresentationLadders(
        (entry as Context<z.ZodType>).useEntries,
      );
    }
  }
}

/**
 * Throw when the statically reachable entry graph contains duplicate ids.
 *
 * Entry ids share one namespace within a prompt. This catches collisions early
 * for contexts, contributors, skills, and other id-bearing static entries; the
 * driver handles dynamically contributed context ids at first resolve.
 */
export function assertUniqueStaticEntryIds(
  entries: readonly ContextEntry[],
  promptId: string | undefined,
): void {
  const seen = new Map<string, ContextEntry>();

  for (const entry of walkStaticEntries(entries)) {
    const id = staticEntryId(entry);
    if (!id) continue;
    const previous = seen.get(id);
    if (previous === entry) continue;
    if (previous) {
      throw new Error(
        `prompt(${promptId ?? "unknown"}): duplicate entry id "${id}" — entry ids must be unique within a prompt.`,
      );
    }
    seen.set(id, entry);
  }
}

/** Collect the full static entry-id namespace reachable from a prompt. */
export function collectStaticEntryIds(
  entries: readonly ContextEntry[],
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const entry of walkStaticEntries(entries)) {
    const id = staticEntryId(entry);
    if (id) ids.add(id);
  }
  return ids;
}

/** Emit context definition warnings once for this prompt compilation. */
export function emitStaticContextDefinitionWarnings(
  entries: readonly ContextEntry[],
  diagnostics: DiagnosticsPort,
): void {
  const seen = new Set<Context<z.ZodType>>();
  for (const entry of walkStaticEntries(entries)) {
    if (!isContextEntry(entry)) continue;
    if (seen.has(entry)) continue;
    seen.add(entry);
    for (const warning of entry.definitionWarnings) {
      diagnostics.warn(warning.message);
    }
  }
}

function* walkStaticEntries(
  entries: readonly ContextEntry[],
): Generator<ContextEntry> {
  for (const entry of entries) {
    if (!entry) continue;
    yield entry;

    if (isContributorEntry(entry)) {
      yield* walkStaticEntries(entry.useEntries);
      continue;
    }

    if (isInternalInjectableEntry(entry)) continue;

    if (isForcedOffload(entry)) continue;

    if (isRepresentationLadder(entry)) {
      yield* walkStaticEntries(representationSources(entry));
      continue;
    }

    if (entry._tag === "MatchSpec") {
      const spec = entry as MatchSpec;
      for (const branch of Object.values(spec.cases)) {
        yield* walkStaticEntries(
          Array.isArray(branch) ? branch : [branch as Context<z.ZodType>],
        );
      }
      if (spec.default) {
        yield* walkStaticEntries(
          Array.isArray(spec.default)
            ? spec.default
            : [spec.default as Context<z.ZodType>],
        );
      }
      continue;
    }

    if (entry._tag === "ConditionalContext") {
      const cond = entry as ConditionalContext<Context<z.ZodType>>;
      yield* walkStaticEntries([cond.context]);
      continue;
    }

    if (entry._tag === "Context") {
      yield* walkStaticEntries(entry.useEntries);
    }
  }
}

function staticEntryId(entry: ContextEntry): string | undefined {
  if (!entry) return undefined;
  if ("id" in entry && typeof (entry as StaticEntryId).id === "string") {
    return (entry as StaticEntryId).id;
  }
  return undefined;
}

function isContextEntry(entry: ContextEntry): entry is Context<z.ZodType> {
  return !!entry && entry._tag === "Context" && "systemFn" in entry;
}
