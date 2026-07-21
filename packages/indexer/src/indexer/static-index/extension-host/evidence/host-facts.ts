import type {
  IndexDiagnostic,
  IndexLintFinding,
  IndexRuleDescriptor,
  ProjectDefinition,
} from "@use-crux/core/project-index";
import type { StaticExtractionResult } from "../../../extensions/runtime/engine";
import type {
  ExtractedFacts,
  ExtractedSourceRef,
} from "../../../extensions/public-contract/types";
import type { StaticRelationRef } from "../../../types";
import {
  canonicalFactExtractorMap,
  canonicalDefinitionExtractors,
  type ProjectIndexDefinitionExtractors,
  type ProjectIndexFactExtractorProvenance,
  type ProjectIndexFactExtractors,
} from "../../../fact-provenance";
import { mediaPrimitiveManifest } from "../../../media/primitive-manifest";
import { embeddingPrimitiveManifest } from "../../../embedding/primitive-manifest";

const FIRST_PARTY_EXTENSIONS = new Set([
  embeddingPrimitiveManifest.name,
  "@use-crux/indexer/crux-core-mcp",
  mediaPrimitiveManifest.name,
]);

/** Grouped fact payload that Static Index finalization can merge directly. */
export interface StaticExtensionNativeFinalizeFacts {
  readonly definitions?: readonly ProjectDefinition[];
  readonly relationRefs?: readonly StaticExtensionNativeRelationRef[];
  readonly sourceRefs?: readonly ExtractedSourceRef[];
  readonly diagnostics?: readonly IndexDiagnostic[];
  readonly lintFindings?: readonly IndexLintFinding[];
  readonly ruleDescriptors?: readonly IndexRuleDescriptor[];
  /** Exact extractor contributors keyed by emitted definition id. */
  readonly definitionExtractors?: ProjectIndexDefinitionExtractors;
  /** Exact extractor contributors keyed by stable emitted fact identity. */
  readonly factExtractors?: ProjectIndexFactExtractors;
}

/** Relation-ref shape consumed by Rust Static Index finalization. */
export interface StaticExtensionNativeRelationRef {
  readonly ownerDefinitionId: string;
  readonly type: string;
  readonly fromId?: string;
  readonly toId?: string;
  readonly toVariable?: string;
  /** Exact contributors carried until native finalization emits a relation. */
  readonly extractors?: readonly ProjectIndexFactExtractorProvenance[];
}

/**
 * Projects TS extractor output into the grouped native finalization shape.
 *
 * Native finalization owns relation binding. This adapter keeps TypeScript
 * extractors as fact producers by forwarding definitions, source refs,
 * diagnostics, and unresolved relation refs as JSON-safe data.
 */
export function nativeFinalizeFactsFromExtractionResults(
  results: readonly StaticExtractionResult[],
): StaticExtensionNativeFinalizeFacts {
  const definitions: ProjectDefinition[] = [];
  const relationRefs: StaticExtensionNativeRelationRef[] = [];
  const sourceRefs: ExtractedSourceRef[] = [];
  const diagnostics: IndexDiagnostic[] = [];
  const definitionExtractors: Record<
    string,
    ProjectIndexFactExtractorProvenance[]
  > = {};
  const factExtractors: Record<string, ProjectIndexFactExtractorProvenance[]> =
    {};

  for (const result of results) {
    if (result.kind === "no-match" || result.kind === "none") continue;
    const contributor = extractorProvenance(result);
    const facts = extractedFacts(result);
    if (result.kind === "degraded") {
      for (const diagnostic of result.diagnostics) {
        diagnostics.push(diagnostic);
        addFactExtractor(
          factExtractors,
          `diagnostics:${diagnostic.id}`,
          contributor,
        );
      }
    }
    if (!facts) continue;
    for (const diagnostic of facts.diagnostics ?? []) {
      diagnostics.push(diagnostic);
      addFactExtractor(
        factExtractors,
        `diagnostics:${diagnostic.id}`,
        contributor,
      );
    }
    for (const sourceRef of facts.sourceRefs ?? []) {
      sourceRefs.push(sourceRef);
      addFactExtractor(
        factExtractors,
        `sourceRefs:${sourceRef.definitionId}:${sourceRef.ref.id}`,
        contributor,
      );
    }
    const definitionIds = appendDefinitions(definitions, facts);
    for (const definitionId of definitionIds) {
      (definitionExtractors[definitionId] ??= []).push(contributor);
      addFactExtractor(
        factExtractors,
        `definitions:${definitionId}`,
        contributor,
      );
    }
    const ownerDefinitionId = definitionIds[0];
    if (!ownerDefinitionId) continue;
    relationRefs.push(
      ...nativeRelationRefs(
        ownerDefinitionId,
        facts.references ?? [],
        contributor,
      ),
    );
  }

  return stripEmptyNativeFacts({
    definitions,
    relationRefs,
    sourceRefs,
    diagnostics,
    definitionExtractors: canonicalDefinitionExtractors(definitionExtractors),
    factExtractors: canonicalFactExtractorMap(factExtractors),
  });
}

/** Projects TS rule output into the grouped native finalization shape. */
export function nativeFinalizeFactsFromRuleOutput(input: {
  readonly lintFindings: readonly IndexLintFinding[];
  readonly ruleDescriptors: readonly IndexRuleDescriptor[];
  readonly diagnostics: readonly IndexDiagnostic[];
}): StaticExtensionNativeFinalizeFacts {
  return stripEmptyNativeFacts({
    lintFindings: input.lintFindings,
    ruleDescriptors: input.ruleDescriptors,
    diagnostics: input.diagnostics,
  });
}

function extractedFacts(
  result: StaticExtractionResult,
): ExtractedFacts | undefined {
  switch (result.kind) {
    case "matched":
      return result.facts;
    case "degraded":
      return result.facts;
    case "none":
    case "no-match":
      return undefined;
    default:
      return assertNever(result);
  }
}

function appendDefinitions(
  definitions: ProjectDefinition[],
  facts: ExtractedFacts,
): readonly string[] {
  const [primary, ...extra] = facts.definitions ?? [];
  if (!primary) return [];
  definitions.push(primary.definition);
  definitions.push(...extra.map((item) => item.definition));
  definitions.push(...(primary.extraDefinitions ?? []));
  return [
    primary.definition.id,
    ...extra.map((item) => item.definition.id),
    ...(primary.extraDefinitions ?? []).map((item) => item.id),
  ];
}

function extractorProvenance(
  result: Exclude<StaticExtractionResult, { readonly kind: "no-match" }>,
): ProjectIndexFactExtractorProvenance {
  return isFirstPartyExtension(result.extension.name)
    ? { name: result.extractor }
    : { name: result.extractor, extension: result.extension };
}

function isFirstPartyExtension(name: string): boolean {
  return FIRST_PARTY_EXTENSIONS.has(name);
}

function nativeRelationRefs(
  ownerDefinitionId: string,
  references: readonly StaticRelationRef[],
  contributor: ProjectIndexFactExtractorProvenance,
): readonly StaticExtensionNativeRelationRef[] {
  return references.map((reference) => ({
    ownerDefinitionId: reference.fromId ?? ownerDefinitionId,
    type: reference.type,
    ...(reference.fromId ? { fromId: reference.fromId } : {}),
    ...((reference.toId ?? reference.fallbackToId)
      ? { toId: reference.toId ?? reference.fallbackToId }
      : {}),
    ...(reference.toVariable ? { toVariable: reference.toVariable } : {}),
    extractors: [contributor],
  }));
}

function addFactExtractor(
  factExtractors: Record<string, ProjectIndexFactExtractorProvenance[]>,
  factId: string,
  contributor: ProjectIndexFactExtractorProvenance,
): void {
  (factExtractors[factId] ??= []).push(contributor);
}

function stripEmptyNativeFacts(input: {
  readonly definitions?: readonly ProjectDefinition[];
  readonly relationRefs?: readonly StaticExtensionNativeRelationRef[];
  readonly sourceRefs?: readonly ExtractedSourceRef[];
  readonly diagnostics?: readonly IndexDiagnostic[];
  readonly lintFindings?: readonly IndexLintFinding[];
  readonly ruleDescriptors?: readonly IndexRuleDescriptor[];
  readonly definitionExtractors?: ProjectIndexDefinitionExtractors;
  readonly factExtractors?: ProjectIndexFactExtractors;
}): StaticExtensionNativeFinalizeFacts {
  return {
    ...(input.definitions?.length ? { definitions: input.definitions } : {}),
    ...(input.relationRefs?.length ? { relationRefs: input.relationRefs } : {}),
    ...(input.sourceRefs?.length ? { sourceRefs: input.sourceRefs } : {}),
    ...(input.diagnostics?.length ? { diagnostics: input.diagnostics } : {}),
    ...(input.lintFindings?.length ? { lintFindings: input.lintFindings } : {}),
    ...(input.ruleDescriptors?.length
      ? { ruleDescriptors: input.ruleDescriptors }
      : {}),
    ...(input.definitionExtractors
      ? { definitionExtractors: input.definitionExtractors }
      : {}),
    ...(input.factExtractors ? { factExtractors: input.factExtractors } : {}),
  };
}

function assertNever(value: never): never {
  throw new Error(
    `Unhandled static extension host fact result: ${JSON.stringify(value)}`,
  );
}
