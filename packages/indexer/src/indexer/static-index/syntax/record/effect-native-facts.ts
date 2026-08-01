import type {
  ProjectDefinition,
  ProjectSourceRef,
} from "@use-crux/core/project-index";
import { fingerprint, safeId } from "../../../definitions";
import { effectRequiredBoundarySourceRefs } from "./effect-boundary-native-facts";
import {
  effectFacts,
  literalString,
  objectValue,
  pathIdentity,
} from "./effect-static-options";
import type {
  StaticCallSourceMatch,
  StaticNativeFactProjection,
  StaticSourceMatch,
  StaticSyntaxValue,
} from "./types";

const PUBLIC_EFFECT_MODULES = new Set([
  "@use-crux/core",
  "@use-crux/core/effect",
]);

/** Projects public effect definitions through the TypeScript syntax frontend. */
export function typeScriptEffectNativeFacts(
  relativePath: string,
  matches: readonly StaticSourceMatch[],
): readonly StaticNativeFactProjection[] {
  const requiredBoundaryRefs = effectRequiredBoundarySourceRefs(
    relativePath,
    matches,
  );
  let ordinal = 0;
  return matches.flatMap((match, matchIndex) => {
    if (!isPublicEffectCall(match)) return [];
    ordinal += 1;
    return [
      effectProjection(
        relativePath,
        match,
        matchIndex,
        ordinal,
        requiredBoundaryRefs,
      ),
    ];
  });
}

function effectProjection(
  relativePath: string,
  match: StaticCallSourceMatch,
  matchIndex: number,
  ordinal: number,
  requiredBoundaryRefs: ReadonlyMap<string, readonly ProjectSourceRef[]>,
): StaticNativeFactProjection {
  const effectId = literalString(match.args[0]);
  const options = objectValue(match.args[2]);
  const hasOptions = match.args.length > 2;
  const facts = effectFacts(effectId, options, hasOptions);
  const version = facts.version;
  const analyzable = effectId !== undefined && version !== undefined;
  const id = analyzable
    ? `effect:${safeId(effectId)}:v${version}`
    : `effect:unanalyzable:${safeId(relativePath)}:${ordinal}`;
  const name = effectId ?? match.variableName;
  const definition: ProjectDefinition = {
    id,
    kind: "effect",
    name,
    source: match.source,
    ...(match.snippet ? { sourceSnippet: match.snippet } : {}),
    fidelity: analyzable ? "resolved" : "partial",
    status: "active",
    fingerprint: fingerprint({
      kind: "effect",
      name,
      file: relativePath,
      ...(match.snippet ? { text: match.snippet.source } : {}),
    }),
    metadata: {
      exportName: match.variableName,
      ...(match.exported ? { exported: true } : {}),
      ...(analyzable
        ? {
            runtimeJoin: {
              definitionId: id,
              kind: "effect" as const,
              name,
              primitive: "effect.run",
              correlationAttributes: ["crux.effect.id", "crux.effect.version"],
              spanAttributes: {
                "crux.effect.id": effectId,
                "crux.effect.version": String(version),
              },
            },
          }
        : {
            sourceStatus: {
              partialReason: "Effect id or version is not a literal",
            },
          }),
      indexPresentation: { standalone: true },
      facts,
      static: true,
    },
  };
  return {
    matchIndex,
    replaces: [
      { extension: "@use-crux/indexer/crux-core", extractor: "effect" },
    ],
    facts: {
      definitions: [{ variableName: match.variableName, definition }],
      references: [],
      sourceRefs: [
        executeSourceRef(id, relativePath, match, ordinal),
        ...(requiredBoundaryRefs.get(id) ?? []).map((ref) => ({
          definitionId: id,
          ref,
        })),
      ],
    },
  };
}

function executeSourceRef(
  definitionId: string,
  relativePath: string,
  match: StaticCallSourceMatch,
  ordinal: number,
): { readonly definitionId: string; readonly ref: ProjectSourceRef } {
  const symbol = identifier(match.args[1]) ?? "inline";
  return {
    definitionId,
    ref: {
      id: `${definitionId}:source:execute:executor:${symbol}:${pathIdentity(relativePath)}:${ordinal}`,
      role: "execute",
      property: "executor",
      symbol,
      source: {
        ...match.source,
        ...(symbol === "inline" ? {} : { function: symbol }),
      },
      ...(match.snippet ? { snippet: match.snippet } : {}),
      fidelity: "resolved",
    },
  };
}

function isPublicEffectCall(
  match: StaticSourceMatch,
): match is StaticCallSourceMatch {
  return (
    match.kind === "call" &&
    match.callee.name === "effect" &&
    match.callee.direct !== false &&
    match.callee.moduleSpecifier !== undefined &&
    PUBLIC_EFFECT_MODULES.has(match.callee.moduleSpecifier)
  );
}

function identifier(value: StaticSyntaxValue | undefined): string | undefined {
  return value?.kind === "identifier" ? value.name : undefined;
}
