import ts from 'typescript'
import type { IndexLintFinding, ProjectDefinition, ProjectRelation, ProjectSourceRef } from '@crux/core/project-index'
import { stringProperty } from '../ast/literals'
import { safeId } from '../definitions'
import type { IndexPatchFacts } from '../patches'
import { semanticLintFactAnalyzer } from './analyzers/lint-fact'
import type { SemanticAnalyzerContext, SemanticDefinitionCandidate, SemanticSourceRefCandidate } from './candidates'
import { semanticDefinitionCandidates } from './discovery'
import { semanticDefinitionEnrichments } from './enrichment-facts'
import { semanticProgram, semanticProgramSourceFiles } from './program'
import { semanticRelationsForCandidate } from './relation-facts'
import { createSemanticAnalyzers, type SemanticDefinitionAnalyzer } from './registry'
import { mergeSemanticAnalyzerResults, runSemanticIndexAnalyzers } from './runner'
import { semanticSchemaCandidates } from './schema-candidates'
import { semanticSourceRefCandidates } from './source-ref-candidates'
import type { SemanticAnalyzerResult, SemanticIndexAnalyzer, SemanticIndexAnalyzerContext } from './types'
import { measureSemanticTiming, type SemanticIndexInstrumentation } from './instrumentation'
import {
  callExpressionName,
  isResolvableSourceExpression,
  propertyInitializer,
  resolveSemanticExpression,
  semanticDefinitionPatchBase,
  semanticExpressionToJsonSchema,
  semanticFallbackOptions,
  semanticNestedSchemaSourceRefs,
  semanticSchemaSourceRef,
  semanticInjectionConditionSourceRefs,
  semanticSourceRef,
  semanticTemplateInterpolationSourceRefs,
  semanticToolMapSourceRefs,
  unwrapExpression,
  variableNameForNode,
} from './model'

interface SemanticSchemaIndexFacts {
  readonly definitions: readonly ProjectDefinition[]
  readonly sourceRefs: readonly { definitionId: string; ref: ProjectSourceRef }[]
  readonly diagnostics: []
}

interface SemanticRelationIndexFacts {
  readonly relations: readonly ProjectRelation[]
  readonly diagnostics: []
}

interface SemanticSourceRefIndexFacts {
  readonly sourceRefs: readonly { definitionId: string; ref: ProjectSourceRef }[]
  readonly diagnostics: []
}

interface SemanticDefinitionEnrichmentIndexFacts {
  readonly definitions: readonly ProjectDefinition[]
  readonly sourceRefs: readonly { definitionId: string; ref: ProjectSourceRef }[]
  readonly relations: readonly ProjectRelation[]
  readonly diagnostics: []
}

interface SemanticLintIndexFacts {
  readonly lintFindings: readonly IndexLintFinding[]
  readonly diagnostics: []
}

interface SemanticIndexFactsOptions {
  /** Optional timing hook for semantic analyzer phases. */
  readonly instrumentation?: SemanticIndexInstrumentation
}

const semanticAnalyzers = createSemanticAnalyzers({
  schemaCandidates: (candidate) =>
    semanticSchemaCandidates(candidate, {
      propertyInitializer,
      isResolvableSourceExpression,
    }),
  sourceRefCandidates: (candidate) =>
    semanticSourceRefCandidates(candidate, {
      propertyInitializer,
      isResolvableSourceExpression,
    }),
  resolveExpression: resolveSemanticExpression,
  expressionToJsonSchema: semanticExpressionToJsonSchema,
  definitionPatchBase: semanticDefinitionPatchBase,
  schemaSourceRef: semanticSchemaSourceRef,
  nestedSchemaSourceRefs: semanticNestedSchemaSourceRefs,
  sourceRef: semanticSourceRef,
  templateInterpolationSourceRefs: semanticTemplateInterpolationSourceRefs,
  toolMapSourceRefs: semanticToolMapSourceRefs,
  injectionConditionSourceRefs: semanticInjectionConditionSourceRefs,
  relationsForCandidate: semanticRelationsForCandidate,
  definitionEnrichments: semanticDefinitionEnrichments,
})
const [
  semanticSchemaAnalyzer,
  semanticSourceRefAnalyzer,
  semanticRelationAnalyzer,
  semanticDefinitionEnrichmentAnalyzer,
] = semanticAnalyzers

const semanticIndexAnalyzers: readonly SemanticIndexAnalyzer[] = [semanticLintFactAnalyzer]

/**
 * Runs the complete semantic index pass for the provided files.
 */
export function semanticIndexFacts(
  root: string,
  files: readonly string[],
  options: SemanticIndexFactsOptions = {},
): IndexPatchFacts {
  if (files.length === 0) return { diagnostics: [] }
  const result = runSemanticAnalyzers(files, semanticAnalyzers, options)
  const indexResult = runSemanticIndexAnalyzers(semanticIndexAnalyzers, {
    definitions: result.definitions,
    relations: result.relations,
  })

  return {
    definitions: result.definitions,
    sourceRefs: result.sourceRefs,
    relations: result.relations,
    lintFindings: indexResult.lintFindings,
    diagnostics: [],
  }
}

/**
 * Runs semantic schema analysis and returns schema metadata/source-ref facts.
 */
export function semanticSchemaIndexFacts(root: string, files: readonly string[]): SemanticSchemaIndexFacts {
  if (files.length === 0) return { definitions: [], sourceRefs: [], diagnostics: [] }
  const result = runSemanticAnalyzer(files, semanticSchemaAnalyzer)

  return {
    definitions: result.definitions,
    sourceRefs: result.sourceRefs,
    diagnostics: [],
  }
}

/**
 * Runs semantic relation analysis and returns resolved relation facts.
 */
export function semanticRelationIndexFacts(root: string, files: readonly string[]): SemanticRelationIndexFacts {
  if (files.length === 0) return { relations: [], diagnostics: [] }
  const result = runSemanticAnalyzer(files, semanticRelationAnalyzer)

  return {
    relations: result.relations,
    diagnostics: [],
  }
}

/**
 * Runs semantic source-reference analysis and returns source refs.
 */
export function semanticSourceRefIndexFacts(root: string, files: readonly string[]): SemanticSourceRefIndexFacts {
  if (files.length === 0) return { sourceRefs: [], diagnostics: [] }
  const result = runSemanticAnalyzer(files, semanticSourceRefAnalyzer)

  return {
    sourceRefs: result.sourceRefs,
    diagnostics: [],
  }
}

/**
 * Runs semantic definition enrichment analysis and returns patch facts.
 */
export function semanticDefinitionEnrichmentIndexFacts(
  root: string,
  files: readonly string[],
): SemanticDefinitionEnrichmentIndexFacts {
  if (files.length === 0) return { definitions: [], sourceRefs: [], relations: [], diagnostics: [] }
  const result = runSemanticAnalyzer(files, semanticDefinitionEnrichmentAnalyzer)

  return {
    definitions: result.definitions,
    sourceRefs: result.sourceRefs,
    relations: result.relations,
    diagnostics: [],
  }
}

/**
 * Runs index-level semantic analyzers such as lint-fact generation.
 */
export function semanticLintIndexFacts(input: SemanticIndexAnalyzerContext): SemanticLintIndexFacts {
  const result = runSemanticIndexAnalyzers(semanticIndexAnalyzers, input)
  return {
    lintFindings: result.lintFindings,
    diagnostics: [],
  }
}

/**
 * Runs a single definition analyzer across all candidate definitions.
 */
function runSemanticAnalyzer(
  files: readonly string[],
  analyzer: SemanticDefinitionAnalyzer,
): Required<SemanticAnalyzerResult> {
  return runSemanticAnalyzers(files, [analyzer])
}

/**
 * Runs all definition analyzers against all candidate definitions.
 */
function runSemanticAnalyzers(
  files: readonly string[],
  analyzers: readonly SemanticDefinitionAnalyzer[],
  options: SemanticIndexFactsOptions = {},
): Required<SemanticAnalyzerResult> {
  const program = measureSemanticTiming(options.instrumentation, 'semantic.program.create', () => semanticProgram(files))
  const checker = measureSemanticTiming(options.instrumentation, 'semantic.checker.create', () =>
    program.getTypeChecker(),
  )
  const context: SemanticAnalyzerContext = { checker }
  const results = measureSemanticTiming(options.instrumentation, 'semantic.analyzer.execution', () => {
    const analyzerResults: SemanticAnalyzerResult[] = []

    for (const sourceFile of semanticProgramSourceFiles(program, files)) {
      for (const candidate of semanticDefinitionCandidates(sourceFile, {
        callExpressionName,
        fallbackOptions: semanticFallbackOptions,
        propertyInitializer,
        safeId,
        stringProperty,
        unwrapExpression,
        variableNameForNode,
      })) {
        for (const analyzer of analyzers) {
          analyzerResults.push(analyzer.analyze(candidate, context))
        }
      }
    }

    return analyzerResults
  })

  return measureSemanticTiming(options.instrumentation, 'semantic.merge', () => mergeSemanticAnalyzerResults(results))
}
