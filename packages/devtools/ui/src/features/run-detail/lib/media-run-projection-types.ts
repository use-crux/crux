/** View-model types for multimodal Runs panels. */

export type SafeRunMediaDescriptor = Readonly<{
  kind: "image" | "audio" | "video" | "file";
  mediaType?: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  pageCount?: number;
  digestPrefix?: string;
  sourceCategory: string;
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

export type MediaLineageNode = Readonly<{
  id: string;
  kind: "input" | "operation" | "output" | "report" | "catalog";
  label: string;
}>;

export type MediaLineageEdge = Readonly<{
  from: string;
  to: string;
  type: string;
}>;

export type MediaRunView = Readonly<{
  summary: MediaRunSummary;
  inputs: readonly SafeRunMediaDescriptor[];
  outputs: readonly SafeRunMediaDescriptor[];
  attempts: readonly MediaRunAttempt[];
  transcript: TranscriptTimelineView;
  lineage: Readonly<{
    nodes: readonly MediaLineageNode[];
    edges: readonly MediaLineageEdge[];
  }>;
  catalogJoinId?: string;
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
}>;
