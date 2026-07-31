/**
 * Resolve inert representation ladders into planner-ready text policy.
 *
 * @module
 */

import type { z } from "zod";
import type { Context, SkillEntry } from "../prompt/context-types";
import {
  LOAD_REFERENCE_TOOL_NAME,
  LOAD_SKILL_TOOL_NAME,
} from "../skill/tools";
import { assertAlternativeCapabilities } from "../request/representation/capabilities";
import {
  compileRepresentationLadder,
  isForcedOffload,
  isRepresentationLadder,
} from "../request/representation/ladder";
import type {
  RepresentationEntry,
  ResolvedRepresentationPolicy,
} from "../request/representation/ladder-types";
import type { InspectPart } from "./types";
import { normalizeSystemContent } from "./system-content";
import type { RepresentationOwnership } from "./contract";

/** Resolve authored rungs without adding their capabilities to the prompt. */
export async function resolveRepresentationPolicies(
  ladders: readonly RepresentationEntry[],
  ownershipByEntry: ReadonlyMap<
    RepresentationEntry,
    RepresentationOwnership
  >,
  skills: readonly SkillEntry[],
  renderSkillIndex: (skills: readonly SkillEntry[]) => string,
  contexts: readonly Context<z.ZodType>[],
  parts: readonly InspectPart[],
  input: Record<string, unknown>,
  count: (text: string) => number,
): Promise<readonly ResolvedRepresentationPolicy[]> {
  const policies: ResolvedRepresentationPolicy[] = [];
  const skillProjection = createSkillProjection(
    skills,
    parts,
    renderSkillIndex,
  );
  for (let declarationOrder = 0; declarationOrder < ladders.length; declarationOrder++) {
    const entry = ladders[declarationOrder]!;
    if (isForcedOffload(entry)) {
      policies.push(Object.freeze({
        contributor: `offload[${declarationOrder}]`,
        sources: Object.freeze([]),
        fullTexts: Object.freeze([]),
        priority: 50,
        declarationOrder,
        ownedToolNames: Object.freeze([]),
        ownedPolicyIds: Object.freeze([]),
        ownedSkillIds: Object.freeze([]),
        ownedToolMiddleware: Object.freeze([]),
        omissionEdits: Object.freeze([]),
        rungs: Object.freeze([
          Object.freeze({ kind: "offload" as const, available: false }),
        ]),
      }));
      continue;
    }
    const compiled = compileRepresentationLadder(entry);
    const ownership = ownershipByEntry.get(entry);
    const ownedSources = ownership?.contexts.length
      ? ownership.contexts
      : collectOwnedSources(compiled.primarySources, contexts);
    const sources = ownedSources.map((source) => {
      const contextIndex = contexts.indexOf(source);
      return source.id
        ? `context:${source.id}`
        : `context[${contextIndex}]`;
    });
    const fullTexts = sources.map(
      (source) => parts.find((part) => part.source === source)?.text ?? "",
    );
    const ownedSkillIds = [
      ...new Set(ownership?.skills.map((skill) => skill.id) ?? []),
    ];
    const omissionEdits = loadedSkillOmissionEdits(
      ownedSkillIds,
      parts,
    );
    const rungs = [];
    for (const rung of compiled.rungs) {
      if (!rung.source) {
        rungs.push(Object.freeze({
          kind: rung.kind,
          available: rung.available,
        }));
        continue;
      }
      if (rung.kind === "full") {
        rungs.push(Object.freeze({
          kind: rung.kind,
          available: true,
        }));
        continue;
      }
      assertAlternativeCapabilities(ownedSources, rung.source, input);
      const content = normalizeSystemContent(
        await rung.source.systemFn(input),
        rung.source.systemKind !== "static",
        count,
        "Representation alternative system function",
        input,
      );
      rungs.push(Object.freeze({
        kind: rung.kind,
        text: content.text,
        available: rung.available,
      }));
    }
    const contextIndex = contexts.indexOf(compiled.primary);
    policies.push(Object.freeze({
      contributor:
        compiled.primary.id ?? `context[${contextIndex}]`,
      sources: Object.freeze(sources),
      fullTexts: Object.freeze(fullTexts),
      priority: Math.max(
        ...ownedSources.map((source) => source.priority),
      ),
      declarationOrder,
      ownedToolNames: Object.freeze(
        [
          ...new Set(
            [
              ...(ownership?.toolNames ?? []),
              ...ownedSources.flatMap((source) =>
                source.toolsFn ? Object.keys(source.toolsFn(input)) : [],
              ),
            ],
          ),
        ],
      ),
      ownedPolicyIds: Object.freeze([
        ...new Set(
          [
            ...(ownership?.constraints ?? []),
            ...(ownership?.guardrails ?? []),
            ...ownedSources.flatMap((source) => [
              ...source.constraints,
              ...source.guardrails,
            ]),
          ].map((policy) => policy.id),
        ),
      ]),
      ownedSkillIds: Object.freeze(ownedSkillIds),
      ownedToolMiddleware: Object.freeze([
        ...(ownership?.toolMiddleware ?? []),
      ]),
      ...(ownedSkillIds.length > 0 && skillProjection
        ? { skillProjection }
        : {}),
      omissionEdits: Object.freeze(omissionEdits),
      rungs: Object.freeze(rungs),
    }));
  }
  return Object.freeze(policies);
}

function loadedSkillOmissionEdits(
  ownedSkillIds: readonly string[],
  parts: readonly InspectPart[],
): readonly {
  readonly source: string;
  readonly fullText: string;
  readonly replacement: string;
}[] {
  if (ownedSkillIds.length === 0) return [];
  const sources = ownedSkillIds.map((id) => ({
    source: `context:__crux_skill_loaded:${id}`,
    replacement: "",
  }));
  return sources.flatMap(({ source, replacement }) => {
    const fullText = parts.find((part) => part.source === source)?.text;
    return fullText === undefined
      ? []
      : [{ source, fullText, replacement }];
  });
}

function createSkillProjection(
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

function collectOwnedSources(
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
      const values = Array.isArray(entry.default)
        ? entry.default
        : [entry.default];
      values.forEach(visitEntry);
    }
    entry.useEntries?.forEach(visitEntry);
  };
  roots.forEach(visitContext);
  return Object.freeze(found);
}
