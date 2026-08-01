/**
 * Redacted connected-knowledge receipt projection types.
 *
 * @module
 */

/** Resolver metadata key carrying recipe traces for request receipt projection. */
export const KNOWLEDGE_TRACE_METADATA_KEY = "crux.request.knowledgeTraces";

/** Redacted connected-knowledge facts projected from recipe traces. */
export interface RequestKnowledgeInspection {
  /** Recipe trace identity that supplied this receipt projection. */
  readonly traceId: string;
  /** Stable recipe identity. */
  readonly recipeId: string;
  /** Stable recipe behavior fingerprint. */
  readonly fingerprint: string;
  /** Step identity inside the recipe. */
  readonly stepId: string;
  /** Knowledge contributor that emitted the step payload. */
  readonly contributor: string;
  /** View membership identity, when the step was view-scoped. */
  readonly view?: { readonly id: string; readonly viewRevision: string | null };
  /** Knowledge generation ids covered by the step. */
  readonly generations: readonly string[];
  /** Coverage mode reported by the trace source. */
  readonly coverage: string;
  /** Content-free coverage basis. */
  readonly coverageBasis: string;
  /** Scan mode reported by global search contributors. */
  readonly scan?: string;
  /** Detail level reported by global search contributors. */
  readonly detail?: string;
  /** Available and processed evidence counts. */
  readonly counts: {
    readonly available: { readonly reports: number; readonly findings?: number };
    readonly processed: { readonly reports: number; readonly findings?: number };
  };
  /** Preflight workload estimate captured before step execution. */
  readonly preflight?: {
    readonly reports: number;
    readonly batches: number;
    readonly inputChars: number;
    readonly calls: number;
  };
  /** Redacted truncation markers reported by the trace source. */
  readonly truncations: readonly string[];
}
