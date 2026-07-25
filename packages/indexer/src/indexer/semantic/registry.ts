import type {
  JsonSchema,
  ProjectDefinition,
  ProjectRelation,
  ProjectSourceRef,
} from "@use-crux/core/project-index";
import { createSemanticDefinitionEnrichmentAnalyzer } from "./analyzers/definition-enrichment";
import { createSemanticRelationAnalyzer } from "./analyzers/relation";
import { createSemanticSchemaAnalyzer } from "./analyzers/schema";
import { createSemanticSourceRefAnalyzer } from "./analyzers/source-ref";
import type {
  SemanticAnalyzerContext,
  SemanticAnalyzerView,
  SemanticDefinitionCandidate,
  SemanticDefinitionEnrichment,
  SemanticResolvedSource,
  SemanticSchemaCandidate,
  SemanticSourceRefCandidate,
} from "./candidates";
import type { SemanticSyntaxNode } from "./syntax-view";
import type { SemanticAnalyzer } from "./types";

export type SemanticDefinitionAnalyzer = SemanticAnalyzer<
  SemanticDefinitionCandidate,
  SemanticAnalyzerContext
>;

/**
 * Runtime hooks required to build the semantic analyzer registry.
 *
 * The registry depends on helper functions owned by `semantic.ts` so analyzers
 * can stay small while compiler-specific details stay behind the view.
 */
export interface SemanticAnalyzerRegistryDeps {
  readonly toolMapSourceRefs: (
    candidate: SemanticDefinitionCandidate,
    view: SemanticAnalyzerView,
  ) => readonly ProjectSourceRef[];
  readonly injectionConditionSourceRefs: (
    candidate: SemanticDefinitionCandidate,
    view: SemanticAnalyzerView,
  ) => readonly ProjectSourceRef[];
  readonly definitionEnrichments: (
    candidate: SemanticDefinitionCandidate,
    view: SemanticAnalyzerView,
  ) => readonly SemanticDefinitionEnrichment[];
  readonly definitionPatchBase: (
    candidate: SemanticDefinitionCandidate,
  ) => ProjectDefinition;
  readonly expressionToJsonSchema: (
    resolved: SemanticResolvedSource,
    view: SemanticAnalyzerView,
  ) => JsonSchema | undefined;
  readonly nestedSchemaSourceRefs: (
    candidate: SemanticSchemaCandidate,
    resolved: SemanticResolvedSource,
    view: SemanticAnalyzerView,
  ) => readonly ProjectSourceRef[];
  readonly relationsForCandidate: (
    candidate: SemanticDefinitionCandidate,
    view: SemanticAnalyzerView,
  ) => readonly ProjectRelation[];
  readonly resolveExpression: (
    expression: SemanticSyntaxNode,
    view: SemanticAnalyzerView,
  ) => SemanticResolvedSource | undefined;
  readonly schemaCandidates: (
    candidate: SemanticDefinitionCandidate,
    view: SemanticAnalyzerView,
  ) => readonly SemanticSchemaCandidate[];
  readonly schemaSourceRef: (
    candidate: SemanticSchemaCandidate,
    resolved: SemanticResolvedSource,
    parsedSchema: boolean,
    view: SemanticAnalyzerView,
  ) => ProjectSourceRef;
  readonly sourceRef: (
    candidate: SemanticSourceRefCandidate,
    resolved: SemanticResolvedSource,
    view: SemanticAnalyzerView,
  ) => ProjectSourceRef;
  readonly sourceRefCandidates: (
    candidate: SemanticDefinitionCandidate,
    view: SemanticAnalyzerView,
  ) => readonly SemanticSourceRefCandidate[];
  readonly templateInterpolationSourceRefs: (
    candidate: SemanticDefinitionCandidate,
    view: SemanticAnalyzerView,
  ) => readonly ProjectSourceRef[];
  readonly promptTextSourceRefs: (
    root: string,
    candidate: SemanticDefinitionCandidate,
    view: SemanticAnalyzerView,
  ) => readonly ProjectSourceRef[];
}

/**
 * Builds the ordered analyzer registry used by `semanticIndexFacts`.
 *
 * Analyzer order is stable so result merging remains deterministic even when
 * multiple analyzers report facts for the same definition.
 */
export function createSemanticAnalyzers(
  deps: SemanticAnalyzerRegistryDeps,
): readonly [
  SemanticDefinitionAnalyzer,
  SemanticDefinitionAnalyzer,
  SemanticDefinitionAnalyzer,
  SemanticDefinitionAnalyzer,
] {
  return [
    createSemanticSchemaAnalyzer({
      schemaCandidates: deps.schemaCandidates,
      resolveExpression: deps.resolveExpression,
      expressionToJsonSchema: deps.expressionToJsonSchema,
      definitionPatchBase: deps.definitionPatchBase,
      schemaSourceRef: deps.schemaSourceRef,
      nestedSchemaSourceRefs: deps.nestedSchemaSourceRefs,
    }),
    createSemanticSourceRefAnalyzer({
      sourceRefCandidates: deps.sourceRefCandidates,
      resolveExpression: deps.resolveExpression,
      sourceRef: deps.sourceRef,
      templateInterpolationSourceRefs: deps.templateInterpolationSourceRefs,
      toolMapSourceRefs: deps.toolMapSourceRefs,
      injectionConditionSourceRefs: deps.injectionConditionSourceRefs,
      promptTextSourceRefs: deps.promptTextSourceRefs,
    }),
    createSemanticRelationAnalyzer({
      relationsForCandidate: deps.relationsForCandidate,
    }),
    createSemanticDefinitionEnrichmentAnalyzer({
      definitionEnrichments: deps.definitionEnrichments,
    }),
  ];
}
