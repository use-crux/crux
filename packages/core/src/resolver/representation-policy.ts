/**
 * Resolve inert representation ladders into planner-ready text policy.
 *
 * @module
 */

import type { z } from "zod";
import type { Context, SkillEntry } from "../prompt/context-types";
import { assertAlternativeCapabilities } from "../request/representation/capabilities";
import {
  compileRepresentationLadder,
  isForcedOffload,
} from "../request/representation/ladder";
import type {
  RepresentationEntry,
  ResolvedRepresentationPolicy,
} from "../request/representation/ladder-types";
import type { InspectPart } from "./types";
import { normalizeSystemContent } from "./system-content";
import type { RepresentationOwnership } from "./contract";
import { summarize } from "../request/history/strategies";
import { OFFLOAD_SUPPORT_TOOL_NAME } from "../request/offload/support-tool";
import {
  collectOwnedSources,
  createSkillProjection,
  findOffloadable,
  findSummarizable,
  loadedSkillOmissionEdits,
  sourceIdentityDigests,
} from "./representation-policy-helpers";

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
        supportToolNames: Object.freeze([OFFLOAD_SUPPORT_TOOL_NAME]),
        omissionEdits: Object.freeze([]),
        offload: Object.freeze({
          value: entry.value,
          options: Object.freeze({}),
          forced: true,
        }),
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
    const sourceDigests = sourceIdentityDigests(sources, parts);
    const ownedSkillIds = [
      ...new Set(ownership?.skills.map((skill) => skill.id) ?? []),
    ];
    const omissionEdits = loadedSkillOmissionEdits(
      ownedSkillIds,
      parts,
    );
    const offload = findOffloadable(entry);
    const summary = findSummarizable(entry);
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
      ...(offload
        ? {
            supportToolNames: Object.freeze([
              OFFLOAD_SUPPORT_TOOL_NAME,
            ]),
            offload: Object.freeze({
              value:
                fullTexts.length === 1
                  ? fullTexts[0]
                  : Object.freeze([...fullTexts]),
              options: offload.options,
              forced: false,
            }),
          }
        : {}),
      ...(ownedSkillIds.length > 0 && skillProjection
        ? { skillProjection }
        : {}),
      omissionEdits: Object.freeze(omissionEdits),
      ...(summary
        ? {
            summary: summaryPolicy(entry, fullTexts, sourceDigests),
          }
        : {}),
      rungs: Object.freeze(rungs),
    }));
  }
  return Object.freeze(policies);
}

function summaryPolicy(
  entry: RepresentationEntry,
  sourceTexts: readonly string[],
  sourceDigests: readonly string[],
): NonNullable<ResolvedRepresentationPolicy["summary"]> {
  const summary = findSummarizable(entry);
  const strategy = summary?.options.strategy ?? summarize.adaptive();
  if (
    strategy._tag !== "SummarizeStrategy" ||
    strategy.version !== 1
  ) {
    throw new TypeError(
      "summarizable() strategy must be created by summarize.",
    );
  }
  return Object.freeze({
    sourceTexts: Object.freeze([...sourceTexts]),
    ...(sourceDigests.length > 0
      ? { sourceDigests: Object.freeze([...sourceDigests]) }
      : {}),
    ...(summary?.options.model !== undefined
      ? { model: summary.options.model }
      : {}),
    strategy,
  });
}
