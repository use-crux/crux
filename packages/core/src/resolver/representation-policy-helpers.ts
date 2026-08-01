/**
 * Helpers for resolving request representation policies.
 *
 * @module
 */

import type { z } from "zod";
import type { Context, SkillEntry } from "../prompt/context-types";
import {
  LOAD_REFERENCE_TOOL_NAME,
  LOAD_SKILL_TOOL_NAME,
} from "../skill/tools";
import {
  compileRepresentationLadder,
  isRepresentationLadder,
} from "../request/representation/ladder";
import type {
  RepresentationEntry,
  ResolvedRepresentationPolicy,
} from "../request/representation/ladder-types";
import type { InspectPart } from "./types";
import { stableHash } from "../indexing/hash";

/** Build content-free revision digests for represented sources. */
export function sourceIdentityDigests(
  sources: readonly string[],
  parts: readonly InspectPart[],
): readonly string[] {
  return Object.freeze(
    sources.flatMap((source) => {
      const part = parts.find((candidate) => candidate.source === source);
      const segments = part?.segments
        ?.flatMap((segment) =>
          segment.sourceVersion
            ? [{ source: segment.source, version: segment.sourceVersion }]
            : [],
        ) ?? [];
      if (!part || (!part.sourceVersion && segments.length === 0)) return [];
      return [stableHash({
        source,
        ...(part.sourceVersion ? { version: part.sourceVersion } : {}),
        segments,
      })];
    }),
  );
}

/** Find a summarizable wrapper inside a legal representation ladder. */
export function findSummarizable(
  entry: RepresentationEntry,
): Extract<RepresentationEntry, { readonly _tag: "summarizable" }> | undefined {
  let current: unknown = entry;
  while (current && typeof current === "object" && "_tag" in current) {
    const node = current as RepresentationEntry;
    if (node._tag === "summarizable") return node;
    if (node._tag !== "offloadable" && node._tag !== "droppable") {
      return undefined;
    }
    current = node.source;
  }
  return undefined;
}

/** Find an offloadable wrapper inside a legal representation ladder. */
export function findOffloadable(
  entry: RepresentationEntry,
): Extract<RepresentationEntry, { readonly _tag: "offloadable" }> | undefined {
  let current: unknown = entry;
  while (current && typeof current === "object" && "_tag" in current) {
    const node = current as RepresentationEntry;
    if (node._tag === "offloadable") return node;
    if (node._tag !== "droppable") return undefined;
    current = node.source;
  }
  return undefined;
}

/** Build edits that remove loaded skill text when a skill contributor is omitted. */
export function loadedSkillOmissionEdits(
  ownedSkillIds: readonly string[],
  parts: readonly InspectPart[],
): readonly {
  readonly source: string;
  readonly fullText: string;
  readonly replacement: string;
}[] {
  if (ownedSkillIds.length === 0) return [];
  return ownedSkillIds.flatMap((id) => {
    const source = `context:__crux_skill_loaded:${id}`;
    const fullText = parts.find((part) => part.source === source)?.text;
    return fullText === undefined
      ? []
      : [{ source, fullText, replacement: "" }];
  });
}

/** Create a skill index projection owned by omitted skill contributors. */
export function createSkillProjection(
  skills: readonly SkillEntry[],
  parts: readonly InspectPart[],
  renderSkillIndex: (skills: readonly SkillEntry[]) => string,
): ResolvedRepresentationPolicy["skillProjection"] {
  if (skills.length === 0) return undefined;
  const source = "context:__crux_skill_index";
  const fullText = parts.find((part) => part.source === source)?.text;
  if (fullText === undefined) return undefined;
  return Object.freeze({
    source,
    fullText,
    allSkillIds: Object.freeze(skills.map((skill) => skill.id)),
    loaderToolNames: Object.freeze([
      LOAD_SKILL_TOOL_NAME,
      LOAD_REFERENCE_TOOL_NAME,
    ]),
    renderRetained: (retainedSkillIds: readonly string[]) => {
      const retained = new Set(retainedSkillIds);
      return renderSkillIndex(
        skills.filter((skill) => retained.has(skill.id)),
      );
    },
  });
}

/** Collect resolved contexts owned by a representation source tree. */
export function collectOwnedSources(
  roots: readonly Context<z.ZodType>[],
  resolved: readonly Context<z.ZodType>[],
): readonly Context<z.ZodType>[] {
  const found: Context<z.ZodType>[] = [];
  const seen = new Set<Context<z.ZodType>>();
  const visitContext = (source: Context<z.ZodType>) => {
    if (seen.has(source) || !resolved.includes(source)) return;
    seen.add(source);
    found.push(source);
    source.useEntries.forEach(visitEntry);
  };
  const visitEntry = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (isRepresentationLadder(value)) {
      compileRepresentationLadder(value).primarySources.forEach(visitContext);
      return;
    }
    const entry = value as {
      readonly _tag?: string;
      readonly context?: Context<z.ZodType>;
      readonly cases?: Readonly<Record<string, unknown>>;
      readonly default?: unknown;
      readonly useEntries?: readonly unknown[];
    };
    if (entry._tag === "Context") {
      visitContext(value as Context<z.ZodType>);
      return;
    }
    if (entry.context) visitContext(entry.context);
    if (entry.cases) Object.values(entry.cases).flat().forEach(visitEntry);
    if (entry.default) {
      const values = Array.isArray(entry.default) ? entry.default : [entry.default];
      values.forEach(visitEntry);
    }
    entry.useEntries?.forEach(visitEntry);
  };
  roots.forEach(visitContext);
  return Object.freeze(found);
}
