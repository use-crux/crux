/** View-model types for multimodal Runs panels. */

/** Canonical observability source categories (matches SafeMediaDescriptor). */
export type SafeRunMediaSourceCategory =
  | "data"
  | "url"
  | "provider-file"
  | "asset-ref"
  | "bytes"
  | "blob"
  | "unknown";

export type SafeRunMediaDescriptor = Readonly<{
  kind: "image" | "audio" | "video" | "file";
  mediaType?: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  pageCount?: number;
  digestPrefix?: string;
  sourceCategory: SafeRunMediaSourceCategory;
}>;

export type MediaRunSummary = Readonly<{
  primitive: string;
  provider?: string;
  model?: string;
  executionKind?: "native" | "composed" | "unknown";
  calls?: number;
  durationMs?: number;
  status?: string;
  costUsd?: number;
  segmentCount?: number;
}>;

export type MediaRunAttempt = Readonly<{
  spanId: string;
  primitive: string;
  name: string;
  status: string;
  parentSpanId?: string | null;
  provider?: string;
  model?: string;
  durationMs?: number;
  role?: "attempt";
  attempt?: number;
  committed?: boolean;
  terminal?: MediaStreamTerminal;
  previewCount?: number;
  deltaCount?: number;
  finalCount?: number;
  byteCount?: number;
  mediaTypes?: readonly string[];
}>;

export type MediaStreamTerminal = "ok" | "error" | "cancelled" | "timeout";

export type MediaStreamSafetyOccurrence = Readonly<{
  phase: "preview" | "final";
  mode: "enforce" | "report" | "unknown";
  action: "allow" | "strip" | "block" | "warn" | "unknown";
  mediaPartType?: "image" | "audio" | "video" | "file";
  outputIndex?: number;
  sequence?: number;
}>;

/** Closed, payload-free view of one logical bounded media stream. */
export type BoundedMediaStreamRun = Readonly<{
  operation: "streamImage" | "streamSpeech";
  role: "logical";
  route?: string;
  committed: boolean;
  attemptCount: number;
  previewCount: number;
  deltaCount: number;
  finalCount: number;
  byteCount: number;
  mediaTypes: readonly string[];
  firstPublicEventMs?: number;
  durationMs?: number;
  terminal: MediaStreamTerminal;
  safety: Readonly<{
    occurrences: readonly MediaStreamSafetyOccurrence[];
    blocked: boolean;
    deltaDelivery:
      | "live"
      | "held-released"
      | "held-discarded"
      | "not-observed";
  }>;
}>;

export type TranscriptSegmentView = Readonly<{
  start?: number;
  end?: number;
  text?: string;
  speaker?: string;
}>;

export type TranscriptTimelineView = Readonly<{
  present: boolean;
  reason?: "local-capture" | "export-absent" | "not-transcription";
  segments: readonly TranscriptSegmentView[];
}>;

/** Structured page/time facts only — never locators, ids, or filenames. */
export type MediaAttribution =
  | Readonly<{ type: "page"; pageNumber: number }>
  | Readonly<{ type: "pages"; pageCount: number }>
  | Readonly<{ type: "time"; start: number; end: number }>;

export type MediaLineageNodeKind =
  | "input"
  | "operation"
  | "output"
  | "report"
  | "catalog"
  | "ingest"
  | "index"
  | "retrieval";

export type MediaLineageNode = Readonly<{
  id: string;
  kind: MediaLineageNodeKind;
  label: string;
  attribution?: MediaAttribution;
}>;

export type MediaLineageEdge = Readonly<{
  from: string;
  to: string;
  type: string;
  attribution?: MediaAttribution;
}>;

/**
 * Runtime → Catalog source join for a media run.
 *
 * `definitionId` is lookup-only and must never be rendered. When status is
 * `unavailable`, completed-media spans did not record an exact Catalog
 * definition identity (see media-run-catalog-join.ts).
 */
export type MediaCatalogJoin =
  | Readonly<{
      status: "joined";
      /** Internal Catalog definition id for navigation/lookup only. */
      definitionId: string;
      /**
       * Safe human label — never the raw definition id or any id-derived
       * suffix. Falls back to a fixed generic when no safe display name exists.
       */
      label: string;
    }>
  | Readonly<{
      status: "unavailable";
      reason: "missing-runtime-join" | "ambiguous-runtime-join";
    }>;

export type MediaRunView = Readonly<{
  summary: MediaRunSummary;
  boundedStream?: BoundedMediaStreamRun;
  inputs: readonly SafeRunMediaDescriptor[];
  outputs: readonly SafeRunMediaDescriptor[];
  attempts: readonly MediaRunAttempt[];
  transcript: TranscriptTimelineView;
  lineage: Readonly<{
    nodes: readonly MediaLineageNode[];
    edges: readonly MediaLineageEdge[];
  }>;
  catalogJoin: MediaCatalogJoin;
}>;

export type GraphLikeRecord = Readonly<{
  type: string;
  primitive?: string;
  name?: string;
  spanId?: string;
  parentSpanId?: string | null;
  status?: string;
  durationMs?: number;
  provider?: string;
  model?: string;
  kind?: string;
  edgeType?: string;
  from?: { kind?: string; id?: string };
  to?: { kind?: string; id?: string };
  attributes?: Record<string, unknown>;
  preview?: unknown;
  artifactId?: string;
  definitionRefs?: readonly Readonly<{
    id: string;
    kind: string;
    role?: string;
  }>[];
}>;
