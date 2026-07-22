import type { TurnDecisionReport } from "../turn-decision-report";
import type {
  CRUX_OBSERVABILITY_SCHEMA_VERSION,
  CruxArtifactId,
  CruxArtifactKind,
  CruxAttributes,
  CruxEdgeId,
  CruxEdgeType,
  CruxGraphNodeRef,
  CruxMetrics,
  CruxRecordId,
  CruxRunId,
  CruxSpanEventId,
  CruxSpanId,
  CruxTraceId,
  DefinitionRef,
} from "../contract";
import type {
  CruxPresentationDisplay,
  CruxPresentationNodeKind,
  CruxPresentationPlacement,
  CruxPresentationPlacementReason,
  CruxRunDetailStatus,
  CruxRunSummaryView,
  CruxSpanSummaryView,
} from "./base";
import type { CruxRunDetailRequest } from "./run-detail-request";
import type {
  CruxCurrentCatalogComparison,
  CruxRunManifestResolution,
} from "./manifest-resolution";
import type { CruxCurrentProjectHealth } from "./project-health";

/** Display metadata for a projected run-detail node or attached detail. */
export interface CruxRunDetailDisplay {
  kind: CruxPresentationNodeKind;
  label: string;
  description?: string;
  icon?: string;
  accent?: string;
  severity?: "info" | "ok" | "warn" | "error" | string;
}

/** Timing roll-up for a run-detail node, row, or attached detail. */
export interface CruxRunDetailTiming {
  startedAt: string;
  endedAt?: string;
  durationMs: number;
  selfMs?: number;
  childrenMs?: number;
  detailsMs?: number;
}

/** Metric roll-ups split by ownership within the presentation tree. */
export interface CruxRunDetailMetricBuckets {
  own?: CruxMetrics | null;
  children?: CruxMetrics | null;
  details?: CruxMetrics | null;
  total?: CruxMetrics | null;
}

/** Inspectable raw item surfaced in a run-detail panel. */
export interface CruxRunDetailInspectionItem {
  type:
    | "span"
    | "event"
    | "artifact"
    | "relation"
    | "diagnostic"
    | "metric"
    | "raw"
    | string;
  id: string;
  label?: string;
  kind?: string;
  role?: string;
  sourceSpanId?: CruxSpanId | string;
  data?: unknown;
}

/** Named groups of inspectable run-detail items. */
export type CruxRunDetailInspectionSections = Record<
  string,
  CruxRunDetailInspectionItem[]
>;

/** Projection diagnostic emitted by the local read-model builder. */
export interface CruxRunDetailDiagnostic {
  code: string;
  severity: "info" | "warn" | "error";
  message: string;
  recordIds?: CruxRecordId[] | string[];
  spanIds?: CruxSpanId[] | string[];
  suggestedFix?: string;
}

/** Artifact summary attached to a run-detail node or detail. */
export interface CruxRunDetailArtifact {
  artifactId: CruxArtifactId;
  runId: CruxRunId;
  traceId: CruxTraceId | "";
  spanId: CruxSpanId | "";
  kind: CruxArtifactKind | string;
  createdAt: string;
  contentType: string;
  encoding: string;
  sizeBytes: number;
  hash: string;
  uri: string;
  preview?: unknown;
  attributes?: CruxAttributes | null;
}

/** Event summary attached to a run-detail node or detail. */
export interface CruxRunDetailEvent {
  eventId: CruxSpanEventId;
  runId: CruxRunId;
  traceId: CruxTraceId | "";
  spanId: CruxSpanId;
  name: string;
  timestamp: string;
  attributes?: CruxAttributes | null;
}

/** Websocket notification for newly ingested observability records. */
export interface CruxObservabilityRecordsNotification {
  _tag: "ObservabilityEvent";
  id: string;
  timestamp: number;
  kind: "observability.records";
  action: "ingested";
  severity: "info";
  refId: CruxRunId | string;
  payload?: {
    operationId: CruxRunId | string;
    entity: "operation";
    traceId?: CruxTraceId | string;
    revision?: number;
  };
}

/** Websocket notification for live token chunk updates. */
export interface CruxTokenChunkNotification {
  _tag: "ObservabilityEvent";
  id: string;
  timestamp: number;
  kind: "token.chunk";
  action: "appended";
  severity: "info";
  refId: CruxRunId | string;
  payload: {
    runId: CruxRunId | string;
    traceId?: CruxTraceId | string;
    spanId: CruxSpanId | string;
    eventId: CruxSpanEventId | string;
    timestamp: string;
    attributes?: CruxAttributes | null;
  };
}

/** Union of local observability websocket notifications. */
export type CruxObservabilityNotification =
  | CruxObservabilityRecordsNotification
  | CruxTokenChunkNotification;

/** Edge summary attached to a run-detail node or detail. */
export interface CruxRunDetailRelation {
  edgeId: CruxEdgeId;
  runId: CruxRunId;
  traceId: CruxTraceId | "";
  edgeType: CruxEdgeType | string;
  from: CruxGraphNodeRef | { kind: string; id: string };
  to: CruxGraphNodeRef | { kind: string; id: string };
  createdAt: string;
  attributes?: CruxAttributes | null;
}

/** Source placement metadata for a projected node or attached detail. */
export interface CruxRunDetailSource {
  placementReason: CruxPresentationPlacementReason;
  ownerSpanId?: CruxSpanId | string;
  canonicalParentSpanId?: CruxSpanId | string;
}

/** Attached non-primary detail in the run-detail tree. */
export interface CruxRunDetailDetail extends CruxSpanSummaryView {
  /** Canonical definition references emitted by this exact span. */
  definitionRefs?: DefinitionRef[];
  id: string;
  kind: CruxPresentationNodeKind;
  role?: string;
  label: string;
  display: Exclude<CruxPresentationDisplay, "primary">;
  timing: CruxRunDetailTiming;
  summary?: string;
  events: CruxRunDetailEvent[];
  artifacts: CruxRunDetailArtifact[];
  relations: CruxRunDetailRelation[];
  diagnostics: CruxRunDetailDiagnostic[];
  source: CruxRunDetailSource;
  inspection?: CruxRunDetailInspectionSections;
  request?: CruxRunDetailRequest;
  /**
   * Per-turn explanation read model projected onto a folded generation detail.
   *
   * Present only for generation details when the local projection has enough
   * recorded evidence. Consumed by the Run Detail `Explain` tab; absent reports
   * leave existing detail views unchanged.
   */
  decisionReport?: TurnDecisionReport;
}

/** Primary node in the run-detail tree. */
export interface CruxRunDetailNode extends CruxSpanSummaryView {
  /** Canonical definition references emitted by this exact span. */
  definitionRefs?: DefinitionRef[];
  id: string;
  virtual: boolean;
  parentId: string;
  path: string[];
  kind: CruxPresentationNodeKind;
  display: CruxRunDetailDisplay;
  timing: CruxRunDetailTiming;
  metricBuckets: CruxRunDetailMetricBuckets;
  source: CruxRunDetailSource;
  details: CruxRunDetailDetail[];
  artifacts: CruxRunDetailArtifact[];
  events: CruxRunDetailEvent[];
  relations: CruxRunDetailRelation[];
  diagnostics: CruxRunDetailDiagnostic[];
  flow?: CruxAttributes | null;
  step?: CruxAttributes | null;
  composition?: CruxAttributes | null;
  transition?: CruxAttributes | null;
  inspection?: CruxRunDetailInspectionSections;
  request?: CruxRunDetailRequest;
  /**
   * Per-turn explanation read model projected onto a generation node.
   *
   * The local Go projection emits one `TurnDecisionReport` per generation turn
   * (and on the run root for run-level roll-up) when projection data is
   * available. The Run Detail `Explain` tab treats it as authoritative when
   * present and falls back to the existing tabs when it is absent.
   */
  decisionReport?: TurnDecisionReport;
  children: CruxRunDetailNode[];
}

/** Flattened row for virtualized run-detail tree rendering. */
export interface CruxRunDetailRow {
  nodeId: string;
  spanId?: CruxSpanId | string;
  parentId: string;
  depth: number;
  path: string[];
  hasChildren: boolean;
  expandedDefault: boolean;
  display: CruxRunDetailDisplay;
  status: CruxRunDetailStatus;
  model?: string;
  provider?: string;
  timing: CruxRunDetailTiming;
  match?: boolean;
}

/** Placement index entry for a source span in the run-detail projection. */
export interface CruxRunDetailSpanPlacement {
  placement: CruxPresentationPlacement;
  nodeId?: string;
  ownerNodeId?: string;
  path: string[];
  reason?: CruxPresentationPlacementReason;
}

/** Full run-detail read model returned by the local observability service. */
export interface CruxRunDetail {
  schemaVersion: typeof CRUX_OBSERVABILITY_SCHEMA_VERSION;
  run: CruxRunSummaryView;
  root: CruxRunDetailNode;
  rows: CruxRunDetailRow[];
  spanIndex: Record<string, CruxRunDetailSpanPlacement>;
  facets: Record<string, Record<string, number>>;
  matches?: Record<string, unknown>;
  diagnostics: CruxRunDetailDiagnostic[];
  counts: {
    primary: number;
    detail: number;
    metadata: number;
    attachedDetails: number;
  };
  /** Canonical runtime refs recovered from authoritative run records. */
  definitionRefs: DefinitionRef[];
  /** Resolution against only the immutable manifest named by the run. */
  manifest?: CruxRunManifestResolution;
  /** Separately labeled comparison against the current checkout, when known. */
  currentCatalog?: CruxCurrentCatalogComparison;
  /** Current authored lint context; never historical evidence or run status. */
  currentProjectHealth?: CruxCurrentProjectHealth;
  debug?: unknown;
  /** Per-lifecycle projections retained inside this operation family. */
  memberRuns: CruxOperationRunDetail[];
}

export interface CruxOperationRunDetail {
  run: CruxRunSummaryView;
  parentRunId?: string;
  triggeredBySpanId?: string;
  root: CruxRunDetailNode;
  diagnostics: CruxRunDetailDiagnostic[];
}
