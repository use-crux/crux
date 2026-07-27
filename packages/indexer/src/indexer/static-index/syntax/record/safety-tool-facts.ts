import type { ExtractedFacts } from "../../../extensions";
import { safeId } from "../../../definitions";
import { staticDefinition } from "../../../static/definition-builder";
import type {
  StaticCallSourceMatch,
  StaticNativeFactProjection,
  StaticSyntaxFileRecord,
  StaticSyntaxValue,
} from "./types";
import {
  createStaticSyntaxInitializerMap,
  staticObjectPropertyValue,
  staticStringValue,
} from "./value";

const SAFETY_MODULES = new Set(["@use-crux/core", "@use-crux/core/safety"]);
const SAFETY_EXTRACTOR = {
  extension: "@use-crux/indexer/crux-core",
  extractor: "safety",
} as const;
const TOOL_BOUNDARY = "model.input.tools";

const BOUNDARY_BY_HELPER = new Map<string, string>([
  ["boundary.input.text", "model.input.text"],
  ["boundary.input.media", "model.input.media"],
  ["boundary.input.tools", TOOL_BOUNDARY],
  ["boundary.input.instructions", "model.instructions"],
  ["boundary.output.text", "model.output.text"],
  ["boundary.output.media", "model.output.media"],
  ["boundary.output.object", "model.output.object"],
  ["boundary.output.both", "model.output"],
  ["boundary.output.path", "model.output.object"],
  ["boundary.memory.write", "memory.write"],
  ["boundary.validation.feedback", "validation.feedback"],
] as const);

const CANONICAL_BOUNDARIES = new Set<string>([
  ...BOUNDARY_BY_HELPER.values(),
  "tool.call",
  "tool.result",
  "approval.request",
]);

/**
 * Projects tool-boundary safety definitions from backend-neutral syntax records.
 *
 * Rust/Oxc supplies complete native safety packets when available. This
 * projection is the shared JavaScript/TypeScript fallback for the newly added
 * tool boundary and deliberately reads only normalized record evidence.
 */
export function staticRecordToolBoundaryFacts(
  root: string,
  record: StaticSyntaxFileRecord,
): readonly ExtractedFacts[] {
  return record.matches.flatMap((match, matchIndex) => {
    if (
      match.kind !== "call" ||
      !isSafetyCall(match) ||
      nativeSafetyFactOwnsMatch(record.nativeFacts, matchIndex)
    ) {
      return [];
    }
    const config = match.objectArg;
    if (!config) return [];
    const boundaries = boundaryIds(staticObjectPropertyValue(config, "on"));
    if (!boundaries.includes(TOOL_BOUNDARY)) return [];

    const initializers = createStaticSyntaxInitializerMap([
      ...record.localInitializers,
      ...(match.localInitializers ?? []),
    ]);
    const policyId =
      staticStringValue(
        staticObjectPropertyValue(config, "id"),
        initializers,
      ) ??
      staticStringValue(
        staticObjectPropertyValue(config, "name"),
        initializers,
      ) ??
      match.localName;
    const id = `guardrail:${safeId(policyId)}`;
    const phase = staticStringValue(
      staticObjectPropertyValue(config, "phase"),
      initializers,
    );
    const mode = staticStringValue(
      staticObjectPropertyValue(config, "mode"),
      initializers,
    );
    const stream = staticStringValue(
      staticObjectPropertyValue(config, "stream"),
      initializers,
    );
    const [boundary] = boundaries;
    const facts = {
      kind: "guardrail" as const,
      policyId,
      ...(phase ? { policy: phase } : {}),
      ...(boundary ? { boundary } : {}),
      boundaries,
    };
    const definition = staticDefinition(
      root,
      record.file,
      id,
      "guardrail",
      policyId,
      undefined,
      match.source,
      match.snippet,
      {
        exportName: match.variableName,
        policyId,
        ...(phase ? { phase } : {}),
        ...(boundary ? { boundary } : {}),
        boundaries,
        ...(mode ? { mode } : {}),
        ...(stream ? { stream } : {}),
        facts,
      },
    );

    return [
      {
        definitions: [{ variableName: match.variableName, definition }],
      },
    ];
  });
}

function isSafetyCall(match: StaticCallSourceMatch): boolean {
  return (
    (match.callee.importedName ?? match.callee.name) === "guardrail" &&
    match.callee.moduleSpecifier !== undefined &&
    SAFETY_MODULES.has(match.callee.moduleSpecifier)
  );
}

function nativeSafetyFactOwnsMatch(
  facts: readonly StaticNativeFactProjection[] | undefined,
  matchIndex: number,
): boolean {
  return Boolean(
    facts?.some(
      (fact) =>
        fact.matchIndex === matchIndex &&
        fact.replaces?.some(
          (replacement) =>
            replacement.extension === SAFETY_EXTRACTOR.extension &&
            replacement.extractor === SAFETY_EXTRACTOR.extractor,
        ),
    ),
  );
}

function boundaryIds(value: StaticSyntaxValue | undefined): string[] {
  const values =
    value?.kind === "array" ? value.elements : value ? [value] : [];
  return [
    ...new Set(
      values.flatMap((candidate) => {
        const boundary = boundaryId(candidate);
        return boundary ? [boundary] : [];
      }),
    ),
  ];
}

function boundaryId(value: StaticSyntaxValue): string | undefined {
  if (
    value.kind === "literal" &&
    typeof value.value === "string" &&
    CANONICAL_BOUNDARIES.has(value.value)
  ) {
    return value.value;
  }
  if (value.kind === "property-access") {
    return BOUNDARY_BY_HELPER.get(value.path.join("."));
  }
  if (value.kind !== "call") return undefined;
  if (value.callee.name === "descriptions" && value.receiver) {
    return boundaryId(value.receiver);
  }
  return BOUNDARY_BY_HELPER.get(
    [...valuePath(value.receiver), value.callee.name].join("."),
  );
}

function valuePath(value: StaticSyntaxValue | undefined): readonly string[] {
  if (value?.kind === "identifier") return [value.name];
  if (value?.kind === "property-access") return value.path;
  return [];
}
