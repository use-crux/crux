import type {
  IncrementalExecutionReport,
  IncrementalPatchCounts,
  IncrementalSemanticStatus,
} from "./execution-types";
import type { IndexPatchInvalidation } from "./invalidation";
import type { IncrementalIndexDecision } from "./types";

interface ExecutionReportInput {
  readonly decision: IncrementalIndexDecision;
  readonly invalidation: IndexPatchInvalidation;
  readonly staticParsedFiles?: readonly string[];
  readonly semanticAnalyzedFiles?: readonly string[];
  readonly fallbackReason?: string;
  readonly durationMsByPhase?: Readonly<Record<string, number>>;
  readonly patchCounts?: IncrementalPatchCounts;
  readonly sourceProfileFileCount?: number;
  readonly semanticStatus?: IncrementalSemanticStatus;
}

/**
 * Creates the JSON-safe report emitted by incremental indexing execution.
 */
export function incrementalExecutionReport(
  input: ExecutionReportInput,
): IncrementalExecutionReport {
  const affected = affectedFromDecision(input.decision);
  return {
    planKind: input.decision.kind,
    fallbackUsed: input.decision.kind === "full-reindex-required",
    fallbackReason: input.fallbackReason,
    astUsedStaticIndex: false,
    graphConfidence: input.decision.graphConfidence,
    changedFiles: input.decision.changedFiles,
    deletedFiles: input.decision.deletedFiles,
    affectedFiles: affected.files,
    affectedDefinitionIds: affected.definitionIds,
    staticParsedFiles: input.staticParsedFiles ?? [],
    staticCacheHits: 0,
    staticCacheMisses: input.staticParsedFiles?.length ?? 0,
    semanticAnalyzedFiles: input.semanticAnalyzedFiles ?? [],
    semanticCacheHits: 0,
    semanticCacheMisses: input.semanticAnalyzedFiles?.length ?? 0,
    invalidatedFiles: input.invalidation.files ?? [],
    invalidatedDefinitionIds: input.invalidation.definitionIds ?? [],
    durationMsByPhase: input.durationMsByPhase ?? {},
    patchCounts: input.patchCounts ?? { ast: 0, semantic: 0, total: 0 },
    sourceProfileFileCount: input.sourceProfileFileCount ?? 0,
    semanticStatus: input.semanticStatus ?? "not-requested",
  };
}

function affectedFromDecision(decision: IncrementalIndexDecision): {
  readonly files: readonly string[];
  readonly definitionIds: readonly string[];
} {
  switch (decision.kind) {
    case "full-reindex-required":
      return { files: decision.files, definitionIds: [] };
    case "source-file-reindex":
    case "dependency-closure-reindex":
    case "semantic-closure-reindex":
      return {
        files: decision.affectedFiles,
        definitionIds: decision.affectedDefinitionIds,
      };
  }
  return assertNever(decision);
}

function assertNever(value: never): never {
  throw new Error(
    `Unhandled incremental execution report decision: ${JSON.stringify(value)}`,
  );
}
