import type {
  ProjectDefinition,
  ProjectRelation,
  ProjectSourceRef,
} from "@use-crux/core/project-index";
import type { IndexPatchFacts } from "../../patches";
import type {
  SemanticAnalyzerContext,
  SemanticAnalyzerSourceFile,
  SemanticAnalyzerView,
  SemanticDefinitionCandidate,
  SemanticSourceRefCandidate,
} from "../candidates";
import { semanticDefinitionCandidates } from "../discovery";
import { semanticDefinitionEnrichments } from "../enrichment-facts";
import {
  projectSemanticEvidenceBatches,
  semanticEvidenceBatchesFromFacts,
  type SemanticEvidenceBatch,
} from "./projection";
import { semanticRelationsForCandidate } from "../relation-facts";
import {
  createSemanticAnalyzers,
  type SemanticDefinitionAnalyzer,
} from "../registry";
import { mergeSemanticAnalyzerResults } from "../runner";
import { semanticSchemaCandidates } from "../schema-candidates";
import { semanticSourceRefCandidates } from "../source-ref-candidates";
import type { SemanticAnalyzerResult } from "../types";
import { measureSemanticTiming } from "../instrumentation";
import { semanticMediaFacts } from "../media-facts";
import { semanticEmbeddingFacts } from "../../embedding/semantic-facts";
import { semanticEvidenceRecordFacts } from "../../evidence-record/semantic-facts";
import { mediaArchitectureLintFindings } from "../media-lints";
import {
  createTypeScriptSemanticFactInput,
  type SemanticIndexFactsOptions,
  type SemanticSourceFileFactInput,
} from "../backends/typescript/fact-input";
import {
  resolveSemanticExpression,
  semanticDefinitionPatchBase,
  semanticExpressionToJsonSchema,
  semanticNestedSchemaSourceRefs,
  semanticSchemaSourceRef,
  semanticInjectionConditionSourceRefs,
  semanticSourceRef,
  semanticTemplateInterpolationSourceRefs,
  semanticToolMapSourceRefs,
} from "../model";
import { semanticPromptTextSourceRefs } from "../model/prompt-text-source-refs";
import { semanticContextPlanningFacts } from "../context-planning/facts";
import { projectPromptTextDiagnosticConclusions } from "./prompt-text-diagnostics";

interface SemanticSchemaIndexFacts {
  readonly definitions: readonly ProjectDefinition[];
  readonly sourceRefs: readonly {
    definitionId: string;
    ref: ProjectSourceRef;
  }[];
  readonly diagnostics: [];
}

interface SemanticRelationIndexFacts {
  readonly relations: readonly ProjectRelation[];
  readonly diagnostics: [];
}

interface SemanticSourceRefIndexFacts {
  readonly sourceRefs: readonly {
    definitionId: string;
    ref: ProjectSourceRef;
  }[];
  readonly diagnostics: [];
}

interface SemanticDefinitionEnrichmentIndexFacts {
  readonly definitions: readonly ProjectDefinition[];
  readonly sourceRefs: readonly {
    definitionId: string;
    ref: ProjectSourceRef;
  }[];
  readonly relations: readonly ProjectRelation[];
  readonly diagnostics: [];
}

const semanticAnalyzers = createSemanticAnalyzers({
  schemaCandidates: (candidate, view) =>
    semanticSchemaCandidates(candidate, view.syntax),
  sourceRefCandidates: (candidate, view) =>
    semanticSourceRefCandidates(candidate, view.syntax),
  resolveExpression: resolveSemanticExpression,
  expressionToJsonSchema: semanticExpressionToJsonSchema,
  definitionPatchBase: semanticDefinitionPatchBase,
  schemaSourceRef: semanticSchemaSourceRef,
  nestedSchemaSourceRefs: semanticNestedSchemaSourceRefs,
  sourceRef: semanticSourceRef,
  templateInterpolationSourceRefs: semanticTemplateInterpolationSourceRefs,
  toolMapSourceRefs: semanticToolMapSourceRefs,
  injectionConditionSourceRefs: semanticInjectionConditionSourceRefs,
  promptTextSourceRefs: semanticPromptTextSourceRefs,
  relationsForCandidate: semanticRelationsForCandidate,
  definitionEnrichments: semanticDefinitionEnrichments,
});
const [
  semanticSchemaAnalyzer,
  semanticSourceRefAnalyzer,
  semanticRelationAnalyzer,
  semanticDefinitionEnrichmentAnalyzer,
] = semanticAnalyzers;

/**
 * Runs the complete semantic index pass for the provided files.
 */
export function semanticIndexFacts(
  root: string,
  files: readonly string[],
  options: SemanticIndexFactsOptions = {},
): IndexPatchFacts {
  return projectSemanticEvidenceBatches(
    semanticIndexEvidenceBatches(root, files, options),
  );
}

/**
 * Runs the complete semantic index pass and yields backend-neutral evidence.
 */
export function* semanticIndexEvidenceBatches(
  root: string,
  files: readonly string[],
  options: SemanticIndexFactsOptions = {},
): Iterable<SemanticEvidenceBatch> {
  if (files.length === 0) {
    yield { kind: "diagnostics", facts: [] };
    return;
  }
  yield* semanticIndexEvidenceBatchesForSourceFiles(
    createTypeScriptSemanticFactInput(root, files, options),
    options,
  );
}

/**
 * Runs semantic analyzers for already prepared source files and compiler view.
 */
export function* semanticIndexEvidenceBatchesForSourceFiles<
  TView extends SemanticAnalyzerView,
>(
  input: SemanticSourceFileFactInput<TView>,
  options: Pick<SemanticIndexFactsOptions, "instrumentation"> = {},
): Iterable<SemanticEvidenceBatch> {
  if (input.sourceFiles.length === 0) {
    yield { kind: "diagnostics", facts: [] };
    return;
  }
  const result = runSemanticAnalyzers(
    input.root,
    input.sourceFiles,
    input.view,
    semanticAnalyzers,
    options,
  );
  const media = semanticMediaFacts(input.sourceFiles, input.view);
  const embeddings = semanticEmbeddingFacts(
    input.root,
    input.sourceFiles,
    input.view,
  );
  const evidenceRecords = semanticEvidenceRecordFacts(
    input.root,
    input.sourceFiles,
    input.view,
  );
  const contextPlanning = semanticContextPlanningFacts(
    input.sourceFiles,
    input.view,
  );
  const authored = mergeSemanticAnalyzerResults([
    result,
    {
      definitions: contextPlanning.definitions,
      sourceRefs: contextPlanning.sourceRefs,
    },
  ]);
  const definitions = [
    ...authored.definitions,
    ...media.definitions,
    ...embeddings.definitions,
    ...evidenceRecords.definitions,
  ];
  const relations = [
    ...authored.relations,
    ...media.relations,
    ...embeddings.relations,
    ...evidenceRecords.relations,
  ];
  const promptTextDiagnostics = projectPromptTextDiagnosticConclusions(
    input.promptTextDiagnosticConclusions?.(result.sourceRefs) ?? [],
  );

  yield* semanticEvidenceBatchesFromFacts({
    definitions,
    sourceRefs: [
      ...authored.sourceRefs,
      ...media.sourceRefs,
      ...embeddings.sourceRefs,
      ...evidenceRecords.sourceRefs,
    ],
    relations,
    diagnostics: promptTextDiagnostics,
    lintFindings: [
      ...media.lintFindings,
      ...embeddings.lintFindings,
      ...evidenceRecords.lintFindings,
      ...contextPlanning.lintFindings,
      ...mediaArchitectureLintFindings(definitions, relations),
    ],
  });
}

/**
 * Runs semantic schema analysis and returns schema metadata/source-ref facts.
 */
export function semanticSchemaIndexFacts(
  root: string,
  files: readonly string[],
): SemanticSchemaIndexFacts {
  if (files.length === 0)
    return { definitions: [], sourceRefs: [], diagnostics: [] };
  const result = runSemanticAnalyzer(root, files, semanticSchemaAnalyzer);

  return {
    definitions: result.definitions,
    sourceRefs: result.sourceRefs,
    diagnostics: [],
  };
}

/**
 * Runs semantic relation analysis and returns resolved relation facts.
 */
export function semanticRelationIndexFacts(
  root: string,
  files: readonly string[],
): SemanticRelationIndexFacts {
  if (files.length === 0) return { relations: [], diagnostics: [] };
  const result = runSemanticAnalyzer(root, files, semanticRelationAnalyzer);

  return {
    relations: result.relations,
    diagnostics: [],
  };
}

/**
 * Runs semantic source-reference analysis and returns source refs.
 */
export function semanticSourceRefIndexFacts(
  root: string,
  files: readonly string[],
): SemanticSourceRefIndexFacts {
  if (files.length === 0) return { sourceRefs: [], diagnostics: [] };
  const result = runSemanticAnalyzer(root, files, semanticSourceRefAnalyzer);

  return {
    sourceRefs: result.sourceRefs,
    diagnostics: [],
  };
}

/**
 * Runs semantic definition enrichment analysis and returns patch facts.
 */
export function semanticDefinitionEnrichmentIndexFacts(
  root: string,
  files: readonly string[],
): SemanticDefinitionEnrichmentIndexFacts {
  if (files.length === 0)
    return { definitions: [], sourceRefs: [], relations: [], diagnostics: [] };
  const result = runSemanticAnalyzer(
    root,
    files,
    semanticDefinitionEnrichmentAnalyzer,
  );

  return {
    definitions: result.definitions,
    sourceRefs: result.sourceRefs,
    relations: result.relations,
    diagnostics: [],
  };
}

/**
 * Runs a single definition analyzer across all candidate definitions.
 */
function runSemanticAnalyzer(
  root: string,
  files: readonly string[],
  analyzer: SemanticDefinitionAnalyzer,
): Required<SemanticAnalyzerResult> {
  const input = createTypeScriptSemanticFactInput(root, files);
  return runSemanticAnalyzers(root, input.sourceFiles, input.view, [analyzer]);
}

/**
 * Runs all definition analyzers against all candidate definitions.
 */
function runSemanticAnalyzers<TView extends SemanticAnalyzerView>(
  root: string,
  sourceFiles: readonly SemanticAnalyzerSourceFile<TView>[],
  view: TView,
  analyzers: readonly SemanticDefinitionAnalyzer[],
  options: Pick<SemanticIndexFactsOptions, "instrumentation"> = {},
): Required<SemanticAnalyzerResult> {
  const context: SemanticAnalyzerContext = { root, view };
  const results = measureSemanticTiming(
    options.instrumentation,
    "semantic.analyzer.execution",
    () => {
      const analyzerResults: SemanticAnalyzerResult[] = [];

      for (const sourceFile of sourceFiles) {
        for (const candidate of semanticDefinitionCandidates(
          sourceFile,
          view.syntax,
        )) {
          for (const analyzer of analyzers) {
            analyzerResults.push(analyzer.analyze(candidate, context));
          }
        }
      }

      return analyzerResults;
    },
  );

  return measureSemanticTiming(options.instrumentation, "semantic.merge", () =>
    mergeSemanticAnalyzerResults(results),
  );
}
