import { createHash } from "node:crypto";
import type {
  EffectFacts,
  EffectStaticPresence,
  ProjectDefinition,
  ProjectSourceRef,
} from "@use-crux/core/project-index";
import { fingerprint, safeId } from "../../../definitions";
import type {
  StaticCallSourceMatch,
  StaticNativeFactProjection,
  StaticObjectValue,
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
  let ordinal = 0;
  return matches.flatMap((match, matchIndex) => {
    if (!isPublicEffectCall(match)) return [];
    ordinal += 1;
    return [effectProjection(relativePath, match, matchIndex, ordinal)];
  });
}

function effectProjection(
  relativePath: string,
  match: StaticCallSourceMatch,
  matchIndex: number,
  ordinal: number,
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
      sourceRefs: [executeSourceRef(id, relativePath, match, ordinal)],
    },
  };
}

function effectFacts(
  effectId: string | undefined,
  options: StaticObjectValue | undefined,
  hasOptions: boolean,
): EffectFacts {
  const versionProperty = effectiveProperty(options, "version");
  const version = options
    ? versionProperty.kind === "absent"
      ? 1
      : versionProperty.kind === "known"
        ? literalNumber(versionProperty.value)
        : undefined
    : hasOptions
      ? undefined
      : 1;
  const recover = effectiveProperty(options, "recover");
  const resource = effectiveProperty(options, "resource");
  const unknownOptions = options === undefined && hasOptions;
  return {
    kind: "effect",
    ...(effectId === undefined ? {} : { effectId }),
    ...(version === undefined ? {} : { version }),
    recoverable: presence(recover, unknownOptions),
    capture: capturePresence(recover, unknownOptions),
    resource: presence(resource, unknownOptions),
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

type EffectiveProperty =
  | { readonly kind: "absent" }
  | { readonly kind: "unknown" }
  | { readonly kind: "known"; readonly value: StaticSyntaxValue };

function effectiveProperty(
  object: StaticObjectValue | undefined,
  name: string,
): EffectiveProperty {
  if (!object) return { kind: "absent" };
  let result: EffectiveProperty = { kind: "absent" };
  for (const item of object.properties) {
    if (item.spread === true) result = { kind: "unknown" };
    else if (item.name === name) result = { kind: "known", value: item.value };
  }
  return result;
}

function presence(
  property: EffectiveProperty,
  hasUnknownContainer: boolean,
): EffectStaticPresence {
  if (property.kind === "known") return true;
  if (property.kind === "unknown" || hasUnknownContainer) return "unknown";
  return false;
}

function capturePresence(
  recover: EffectiveProperty,
  hasUnknownContainer: boolean,
): EffectStaticPresence {
  if (
    recover.kind === "unknown" ||
    (hasUnknownContainer && recover.kind === "absent")
  ) {
    return "unknown";
  }
  if (recover.kind === "absent") return false;
  const recoverObject = objectValue(recover.value);
  if (!recoverObject) {
    return recover.value.kind === "function" ? false : "unknown";
  }
  const capture = effectiveProperty(recoverObject, "capture");
  const execute = effectiveProperty(recoverObject, "execute");
  if (capture.kind === "known" && execute.kind === "known") return true;
  if (capture.kind === "unknown" || execute.kind === "unknown")
    return "unknown";
  return false;
}

function objectValue(
  value: StaticSyntaxValue | undefined,
): StaticObjectValue | undefined {
  return value?.kind === "object" ? value : undefined;
}

function literalString(
  value: StaticSyntaxValue | undefined,
): string | undefined {
  return value?.kind === "literal" && typeof value.value === "string"
    ? value.value
    : undefined;
}

function literalNumber(
  value: StaticSyntaxValue | undefined,
): number | undefined {
  return value?.kind === "literal" &&
    typeof value.value === "number" &&
    Number.isFinite(value.value)
    ? value.value
    : undefined;
}

function identifier(value: StaticSyntaxValue | undefined): string | undefined {
  return value?.kind === "identifier" ? value.name : undefined;
}

function pathIdentity(relativePath: string): string {
  const hash = createHash("sha256").update(relativePath).digest("hex");
  return `${safeId(relativePath)}:${hash.slice(0, 16)}`;
}
