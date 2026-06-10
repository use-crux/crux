import type { JsonSchema, ProjectDefinition, ProjectRelation, ProjectSourceRef } from '@crux/core/project-index'
import type * as ts from 'typescript'
import { createSemanticDefinitionEnrichmentAnalyzer } from './analyzers/definition-enrichment'
import { createSemanticRelationAnalyzer } from './analyzers/relation'
import { createSemanticSchemaAnalyzer } from './analyzers/schema'
import { createSemanticSourceRefAnalyzer } from './analyzers/source-ref'
import type {
  SemanticAnalyzerContext,
  SemanticDefinitionCandidate,
  SemanticDefinitionEnrichment,
  SemanticResolvedSource,
  SemanticSchemaCandidate,
  SemanticSourceRefCandidate,
} from './candidates'
import type { SemanticAnalyzer } from './types'

export type SemanticDefinitionAnalyzer = SemanticAnalyzer<SemanticDefinitionCandidate, SemanticAnalyzerContext>

/**
 * Runtime hooks required to build the semantic analyzer registry.
 *
 * The registry depends on helper functions owned by `semantic.ts` so analyzers
 * can stay small while the legacy resolver helpers are migrated gradually.
 */
export interface SemanticAnalyzerRegistryDeps {
  readonly toolMapSourceRefs: (
    candidate: SemanticDefinitionCandidate,
    checker: ts.TypeChecker,
  ) => readonly ProjectSourceRef[]
  readonly definitionEnrichments: (
    candidate: SemanticDefinitionCandidate,
    checker: ts.TypeChecker,
  ) => readonly SemanticDefinitionEnrichment[]
  readonly definitionPatchBase: (candidate: SemanticDefinitionCandidate) => ProjectDefinition
  readonly expressionToJsonSchema: (resolved: SemanticResolvedSource, checker: ts.TypeChecker) => JsonSchema | undefined
  readonly nestedSchemaSourceRefs: (
    candidate: SemanticSchemaCandidate,
    resolved: SemanticResolvedSource,
    checker: ts.TypeChecker,
  ) => readonly ProjectSourceRef[]
  readonly relationsForCandidate: (
    candidate: SemanticDefinitionCandidate,
    checker: ts.TypeChecker,
  ) => readonly ProjectRelation[]
  readonly resolveExpression: (expression: ts.Expression, checker: ts.TypeChecker) => SemanticResolvedSource | undefined
  readonly schemaCandidates: (candidate: SemanticDefinitionCandidate) => readonly SemanticSchemaCandidate[]
  readonly schemaSourceRef: (
    candidate: SemanticSchemaCandidate,
    resolved: SemanticResolvedSource,
    parsedSchema: boolean,
  ) => ProjectSourceRef
  readonly sourceRef: (candidate: SemanticSourceRefCandidate, resolved: SemanticResolvedSource) => ProjectSourceRef
  readonly sourceRefCandidates: (candidate: SemanticDefinitionCandidate) => readonly SemanticSourceRefCandidate[]
  readonly templateInterpolationSourceRefs: (
    candidate: SemanticDefinitionCandidate,
    checker: ts.TypeChecker,
  ) => readonly ProjectSourceRef[]
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
    }),
    createSemanticRelationAnalyzer({
      relationsForCandidate: deps.relationsForCandidate,
    }),
    createSemanticDefinitionEnrichmentAnalyzer({
      definitionEnrichments: deps.definitionEnrichments,
    }),
  ]
}
