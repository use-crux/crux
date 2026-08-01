import type {
  CruxDeploymentIdentity,
  ProjectDefinitionKind,
} from "../project-index";
import type { ModelInputOrigin } from "../safety/input-origin";
import type { SafetyFinding } from "../safety/decision";
import type {
  CruxArtifactKind,
  CruxEdgeType,
  CruxPrimitiveFamily,
  CruxPrimitiveName,
} from "./taxonomy";
export * from "./taxonomy";

export const CRUX_OBSERVABILITY_SCHEMA_VERSION = 5;

export const CRUX_CONTENT_DEGRADED_EVENT = "content.degraded" as const;


type Brand<T, Name extends string> = T & { readonly __brand: Name };

export type CruxRunId = Brand<string, "CruxRunId">;
export type CruxTraceId = Brand<string, "CruxTraceId">;
export type CruxSpanId = Brand<string, "CruxSpanId">;
export type CruxSpanEventId = Brand<string, "CruxSpanEventId">;
export type CruxEdgeId = Brand<string, "CruxEdgeId">;
export type CruxArtifactId = Brand<string, "CruxArtifactId">;
export type CruxRecordId = Brand<string, "CruxRecordId">;
export type CruxSegmentId = Brand<string, "CruxSegmentId">;

export type CruxRunStatus =
  | "running"
  | "ok"
  | "error"
  | "blocked"
  | "cancelled"
  | "suspended";
export type CruxSpanStatus = CruxRunStatus | "skipped";

export interface CruxContentDegradedEventAttributes extends Record<
  string,
  unknown
> {
  partType: string;
  mediaType?: string;
  role: string;
  provider: string;
  reason: string;
}

export type CruxContextContributionState =
  | "active"
  | "checked-not-included"
  | "dropped-budget"
  | "disabled";
export type CruxContextInjectableKind =
  | "prompt"
  | "context"
  | "conditional"
  | "match"
  | "skill"
  | "memory"
  | "blackboard"
  | "retriever"
  | "handoff"
  | "injectable";
export type CruxContextInjects =
  | "system"
  | "tools"
  | "constraints"
  | "guardrails";
export type CruxContextCacheStatus = "hit" | "miss" | "disabled";

export interface CruxContextTextSegmentPreview {
  text: string;
  dynamic: boolean;
  source?: string;
  observedAt?: number;
  sourceVersion?: string;
}

/**
 * Exact resolved user PromptText retained by an ordinary captured generation.
 *
 * Segment text must reconstruct `text` exactly. The record lives only inside
 * the policy-controlled input artifact and is absent for ordinary strings.
 */
export interface CruxPromptTextUserPromptPreview {
  readonly kind: "prompt-text";
  readonly text: string;
  readonly segments: readonly Readonly<CruxContextTextSegmentPreview>[];
  readonly tokens: number;
  readonly staticTokens: number;
  readonly dynamicTokens: number;
}

export interface CruxContextContributionPreview {
  kind: "context.contribution";
  state: CruxContextContributionState;
  included: boolean;
  sourceId: string;
  injectableKind: CruxContextInjectableKind;
  reason?: string;
  branch?: string;
  injects?: readonly CruxContextInjects[];
  priority?: number;
  sizeBytes?: number;
  tokens?: number;
  cacheStatus?: CruxContextCacheStatus;
  servedFrom?: "live" | "memo";
  resolvedAt?: number;
  age?: number;
  observedAt?: number;
  sourceVersion?: string;
  injectedTools?: readonly string[];
  segments?: readonly CruxContextTextSegmentPreview[];
  staticTokens?: number;
  dynamicTokens?: number;
  text?: string;
}

export interface CruxPromptBudgetPreview {
  kind: "prompt.budget";
  usedTokens: number;
  totalTokens: number;
  prefixOverflow?: true;
  dropped: readonly CruxContextContributionPreview[];
}

/** One content-free contributor represented in an executed request plan. */
export interface CruxRequestPlanContributionPreview {
  id: string;
  sources: readonly string[];
  priority: number;
  boundary: "required" | "sticky" | "elastic";
  representations: readonly string[];
}

/** Redacted executed-request evidence retained on the canonical event spine. */
export interface CruxRequestPlanPreview {
  kind: "request.plan";
  stage: "sealed" | "completed";
  receipt: {
    id: string;
    model: string;
    inputTokens: number;
    maxInputTokens: number;
    measurement: "exact" | "estimated" | "conservative";
    adaptations: readonly {
      contributor: string;
      representation: "authored" | "summary" | "offload" | "omitted";
      fullTokens?: number;
      selectedTokens?: number;
      supportRequestId?: string;
      supportRequestIds?: readonly string[];
    }[];
    warnings: readonly { code: string; message: string }[];
    previousRequestId?: string;
  };
  inspection: {
    id: string;
    contributions: readonly CruxRequestPlanContributionPreview[];
    candidates: readonly unknown[];
    breakdown: unknown;
    measurement: "exact" | "estimated" | "conservative";
    counting: unknown;
    retryCount: number;
    artifacts: readonly unknown[];
    supportTools: readonly string[];
    supportRequests: readonly unknown[];
    linkedRequestIds: readonly string[];
    preparation?: unknown;
    retention: "requires observability retention";
  };
}

export interface CruxPromptInputPreview {
  kind: "prompt.input";
  promptId?: string;
  validationStatus: "passed" | "failed" | "not-configured";
  providedKeys: readonly string[];
  schemaKeys?: readonly string[];
  requiredKeys?: readonly string[];
  missingKeys?: readonly string[];
  unexpectedKeys?: readonly string[];
}

export interface CruxRetrievalHitPreview {
  rank: number;
  source: {
    id: string;
    url?: string;
    path?: string;
    assetRef?: { uri: string };
    mediaType?: string;
    location?:
      | { type: "page"; pageNumber: number }
      | { type: "time"; unit: "seconds"; start: number; end: number };
  };
  chunkId: string;
  score?: number;
  preview?: string;
}

export interface CruxRetrievalStagePreview {
  name: string;
  phase?: "query" | "hits";
  kind?: string;
  status?: "success" | "error" | "skipped";
  inHits?: number;
  outHits?: number;
  inQueries?: number;
  outQueries?: number;
  note?: string;
}

export interface CruxRetrievalHitsPreview {
  kind: "retrieval.hits";
  query: string;
  mode?: string;
  recipeId?: string;
  fusion?: string;
  limit?: number;
  returned: number;
  hits: readonly CruxRetrievalHitPreview[];
  stages?: readonly CruxRetrievalStagePreview[];
}

export interface CruxMemoryRecalledBlockPreview {
  blockKind: string;
  key: string;
  preview: string;
  score?: number;
}

export interface CruxMemoryRecallPreview {
  kind: "memory.recall";
  memoryType?: string;
  blockKind: string;
  operation: string;
  query?: string;
  returned: number;
  blocks: readonly CruxMemoryRecalledBlockPreview[];
}

export interface CruxMemoryBlockSummaryPreview {
  blockKind: string;
  key?: string;
  preview: string;
  score?: number;
}

export interface CruxMemoryDiffPreview {
  kind: "memory.diff";
  memoryType?: string;
  blockKind: string;
  operation: string;
  before?: unknown;
  after?: unknown;
  added?: readonly CruxMemoryBlockSummaryPreview[];
  removed?: readonly CruxMemoryBlockSummaryPreview[];
  updated?: readonly CruxMemoryBlockSummaryPreview[];
}

export interface CruxCitationMarkerPreview {
  marker: string;
  start?: number;
  end?: number;
  outputQuote?: string;
  sourceId?: string;
  chunkId?: string;
  score?: number;
  grounded?: boolean;
  note?: string;
}

export interface CruxCitationReportPreview {
  kind: "citation.report";
  valid?: boolean;
  markers: readonly CruxCitationMarkerPreview[];
  summary?: Record<string, number | string | boolean>;
}

export interface CruxScoreJudgePreview {
  name: string;
  score?: number;
  threshold?: number;
  status?: "passed" | "failed" | "warn" | string;
  rationale?: string;
}

export interface CruxScoreReportPreview {
  kind: "score.report";
  verdict?: "pass" | "fail" | string;
  primaryFailureType?: string;
  score?: number;
  rawScore?: number;
  reasoningPreview?: string;
  judges?: readonly CruxScoreJudgePreview[];
  expected?: unknown;
  actual?: unknown;
}

export interface CruxCompositionBranchPreview {
  id: string;
  agentId?: string;
  status: "success" | "error" | "skipped" | string;
  durationMs?: number;
  tokens?: number;
  resultPreview?: unknown;
  error?: string;
}

export interface CruxCompositionVotePreview {
  agent: string;
  answer?: string;
  confidence?: number;
  reasoning?: string;
}

export interface CruxCompositionStagePreview {
  name: string;
  status?: "success" | "error" | "skipped" | string;
  outputPreview?: unknown;
}

export interface CruxCompositionReportPreview {
  kind: "composition.report";
  compositionType: "parallel" | "pipeline" | "consensus" | "swarm";
  compositionId?: string;
  status?: "success" | "error" | string;
  branches?: readonly CruxCompositionBranchPreview[];
  stages?: readonly CruxCompositionStagePreview[];
  agreement?: number;
  quorum?: "majority" | "unanimous" | number;
  votes?: readonly CruxCompositionVotePreview[];
  handoffPath?: readonly string[];
  handoffCount?: number;
  finalAgentId?: string;
  roster?: readonly {
    id: string;
    role?: string;
    turns?: number;
    durationMs?: number;
    tokens?: number;
  }[];
  wallTimeMs?: number;
  serialTimeMs?: number;
}

export interface CruxHandoffPayloadPreview {
  kind?: "handoff.payload";
  handoffId?: string;
  fromAgent?: string;
  toAgent?: string;
  hop?: number;
  totalHops?: number;
  reason?: string;
  contract?: { input?: string; output?: string };
  inputSize?: number;
  outputSize?: number;
  beforeSize?: number;
  afterSize?: number;
  summary?: string;
  data?: unknown;
}

export interface CruxDelegateReportPreview {
  kind: "delegate.report";
  delegateId: string;
  handoffId?: string;
  caller?: string;
  callee?: string;
  inputSize?: number;
  outputSize?: number;
  subRunId?: string;
  args?: unknown;
  resultPreview?: unknown;
}

export interface CruxConstraintAttemptPreview {
  n: number;
  status: "pass" | "fail" | "retry" | string;
  feedback?: string;
}

export interface CruxConstraintReportPreview {
  kind: "constraint.report";
  assertion?: string;
  constraint?: string;
  severity?: string;
  pass?: boolean;
  feedback?: string;
  attempts?: readonly CruxConstraintAttemptPreview[];
  nextAttempt?: number;
  metadata?: unknown;
}

export interface CruxGuardrailMatchPreview {
  kind?: string;
  from?: string;
  to?: string;
  note?: string;
}

/** Privacy-safe semantic model-ingress provenance carried by guardrail reports. */
export type CruxModelInputOriginPreview = ModelInputOrigin;

/** Canonical validated finding exposed without media or rubric content. */
export type CruxGuardrailFindingPreview = SafetyFinding;

export interface CruxGuardrailReportPreview {
  kind: "guardrail.report";
  /** Canonical Safety target and render-safe display label. */
  target?: { id: string; label: string };
  phase?: string;
  action: "pass" | "block" | "redact" | "transform" | "warn" | string;
  boundary?: string;
  mode?: "enforce" | "report" | string;
  /** Safe semantic ingress provenance; never input or provider content. */
  origin?: CruxModelInputOriginPreview;
  mediaPartType?: "image" | "audio" | "video" | "file" | string;
  originKind?: "message" | "step" | "operation" | string;
  messageIndex?: number;
  stepIndex?: number;
  operation?: string;
  operationPhase?: "input" | "output" | "preview" | "final" | string;
  field?: string;
  partIndex?: number;
  /** Zero-based public media output coordinate for streaming Safety. */
  outputIndex?: number;
  /** Zero-based provisional-event coordinate within one media output. */
  sequence?: number;
  escalatedToBlock?: true;
  /** Validated audit evidence; detailed values never become span attributes. */
  findings?: readonly CruxGuardrailFindingPreview[];
  matches?: readonly CruxGuardrailMatchPreview[];
  reason?: string;
  beforePreview?: string;
  afterPreview?: string;
}

export interface CruxRoutingTierPreview {
  /** Optional display index; canonical receipts use the tier's array position. */
  tier?: number;
  model: string;
  status?: "accepted" | "rejected" | "skipped" | "error" | string;
  budget?: number;
  verdict?: "accepted" | "rejected" | "skipped" | "error" | string;
  note?: string;
  confidence?: number;
  cost?: number | null;
  judgeCost?: number;
  durationMs?: number;
}

export interface CruxRoutingAttemptPreview {
  model: string;
  status: "ok" | "error" | string;
  durationMs?: number;
  cost?: number | null;
  errorCategory?: string;
  error?: string;
  delayMs?: number;
}

export type CruxRoutingStepPreview =
  | {
      kind: "router";
      id?: string;
      classifiedAs?: string;
      route?: string;
      usedDefaultRoute?: boolean;
      forced?: boolean;
    }
  | { kind: "split"; id?: string; route?: string; seed?: string }
  | {
      kind: "retry";
      id?: string;
      model?: string;
      attempts?: readonly CruxRoutingAttemptPreview[];
    }
  | {
      kind: "fallback";
      id?: string;
      attempts?: readonly CruxRoutingAttemptPreview[];
      firstTokenAt?: number;
      midStreamFailure?: boolean;
    }
  | {
      kind: "cascade";
      id?: string;
      tiers?: readonly CruxRoutingTierPreview[];
      acceptedAtTier?: number;
      budgetExceeded?: boolean;
    };

export interface CruxRoutingReportPreview {
  model: string;
  /** Total routed cost, or `null` when JSON-safe transport preserves an unavailable value. */
  cost?: number | null;
  /** Elapsed milliseconds from stream hand-off to the first emitted token. */
  firstTokenAt?: number;
  trace: readonly CruxRoutingStepPreview[];
}

export interface CruxCacheReportPreview {
  kind: "cache.report";
  cacheKind: string;
  status: "hit" | "miss" | "mixed" | "write" | string;
  key?: string;
  hitCount?: number;
  missCount?: number;
  skippedSpanId?: CruxSpanId | string;
  saved?: {
    tokens?: number;
    costUsd?: number;
    latencyMs?: number;
  };
}

export interface CruxCompactionReportPreview {
  kind: "compaction.report";
  strategy: string;
  beforeTokens: number;
  afterTokens: number;
  compressionRatio?: number;
  summarizedPreview?: string;
}

export interface CruxEmbeddingReportPreview {
  kind: "embedding.report";
  embeddingKind: "dense" | "sparse" | string;
  embeddingName?: string;
  dimensions?: number;
  inputCount: number;
  chunkCount?: number;
  cacheHitCount?: number;
  cacheMissCount?: number;
  cacheHitRatio?: number;
  truncatedCount?: number;
  retryCount?: number;
  rateLimitWaitMs?: number;
}

export interface CruxSourceStageCountsPreview {
  parse?: number;
  chunk?: number;
  embed?: number;
  store?: number;
  [key: string]: number | undefined;
}

export interface CruxCorpusSourcePreview {
  id: string;
  action:
    | "added"
    | "changed"
    | "unchanged"
    | "skipped"
    | "failed"
    | "stale"
    | "deleted"
    | string;
  reason?: string;
  chunks?: number;
}

export interface CruxIndexingReportPreview {
  kind: "indexing.report";
  indexerId?: string;
  namespace?: string;
  operation: string;
  totals: {
    sources: number;
    chunks: number;
    parents?: number;
    added?: number;
    changed?: number;
    unchanged?: number;
    skipped?: number;
    failed?: number;
    stale?: number;
    deleted?: number;
  };
  stageCounts?: CruxSourceStageCountsPreview;
  sources?: readonly CruxCorpusSourcePreview[];
}

export interface CruxIngestReportPreview {
  kind: "ingest.report";
  sourceId: string;
  status: "success" | "failed";
  parser?: string;
  warningCount?: number;
  parts?: number;
  chunks?: number;
  reason?: string;
}

export interface CruxCorpusReportPreview {
  kind: "corpus.report";
  corpusId?: string;
  namespace?: string;
  mode?: string;
  stalePolicy?: string;
  totals: {
    added: number;
    changed: number;
    unchanged: number;
    skipped: number;
    failed: number;
    stale: number;
    deleted: number;
    chunks: number;
  };
  sources: readonly CruxCorpusSourcePreview[];
  stageCounts?: CruxSourceStageCountsPreview;
}

export interface CruxSecurityReportPreview {
  kind: "security.report";
  severity: "info" | "warn" | "error" | string;
  pattern: string;
  location?: string;
  action: "warn" | "block" | "redact" | "transform" | string;
  message?: string;
  preview?: string;
}

export interface CruxSourceLocation {
  file: string;
  line: number;
  column?: number;
  function?: string;
}

/**
 * Repo-relative source pointer attached to runtime evidence. Scalars match
 * {@link CruxSourceLocation} conventions (positive line, optional positive
 * column) but omit the transient call-site `function` name.
 */
export interface SanitizedSourceRef {
  file: string;
  line: number;
  column?: number;
}

/**
 * Closed set of roles a project definition can play as runtime evidence
 * attached to a run or span record. Extend deliberately alongside the schema
 * ({@link import('./schema').DefinitionRefRoleSchema}) and the directly-observed
 * role map in `./definition-ref`; unknown roles are rejected on the wire.
 *
 * Each role names the relationship the definition had with the record's
 * execution — a `resolved-*` definition was assembled/materialized, while an
 * `invoked-*`/`loaded-*` definition was executed. There is one role per
 * definition family (composition's four kinds and routing's five kinds each
 * share a single family role), never one per concrete `ProjectDefinitionKind`.
 */
export type DefinitionRefRole =
  | "resolved-prompt"
  | "resolved-context"
  | "resolved-mcp-server"
  | "invoked-tool"
  | "invoked-agent"
  | "invoked-flow"
  | "invoked-retriever"
  | "invoked-composition"
  | "invoked-blackboard"
  | "invoked-routing"
  | "loaded-skill"
  | "invoked-guardrail"
  | "invoked-constraint"
  | "invoked-task"
  | "invoked-effect"
  | "invoked-thread"
  | "invoked-workspace"
  | "invoked-memory"
  | "invoked-recipe"
  | "invoked-reranker"
  | "contributed-knowledge-base"
  | "contributed-tool-policy"
  | "invoked-flow-step"
  | "invoked-composition-branch"
  | "invoked-recipe-step"
  | "invoked-scorer"
  | "invoked-media-operation";

/**
 * Evidence linking a runtime record back to the Project Index definition it
 * resolved or invoked. Carries only stable identity — no fingerprint or
 * project-revision, which belong to the index read-model, not the wire record.
 */
export interface DefinitionRef {
  id: string;
  kind: ProjectDefinitionKind;
  role: DefinitionRefRole;
  source?: SanitizedSourceRef;
}

export const CRUX_TOKEN_METRIC_KEYS = [
  "inputTokens",
  "outputTokens",
  "totalTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "reasoningTokens",
  "costUsd",
  "ttftMs",
  "tokensPerSecond",
] as const;

export const CRUX_GENERATION_METRIC_KEYS = [
  "gen.duration_ms",
  "gen.time_to_first_token_ms",
  "gen.output_tokens_per_second",
  "gen.time_per_output_chunk_ms",
] as const;

export type CruxTokenMetricKey = (typeof CRUX_TOKEN_METRIC_KEYS)[number];
export type CruxGenerationMetricKey =
  (typeof CRUX_GENERATION_METRIC_KEYS)[number];
export type CruxCustomMetricKey = `custom.${string}`;
export type CruxMetricKey =
  | CruxTokenMetricKey
  | CruxGenerationMetricKey
  | CruxCustomMetricKey;
export type CruxTokenMetrics = Partial<Record<CruxTokenMetricKey, number>>;
declare const cruxMetricsInputBrand: unique symbol;

export type CruxAttributes = Record<string, unknown>;

/**
 * Numeric measurements attached to terminal run/span records.
 *
 * Metric values may be `undefined` at the TypeScript boundary so callers can
 * pass natural optional expressions such as `{ inputTokens: usage?.input }`.
 * The emit pipeline strips `undefined`, `NaN`, and infinite values before a
 * record reaches subscribers, diagnostics channels, or transports.
 */
export type CruxMetrics = Partial<Record<CruxMetricKey, number | undefined>> & {
  readonly [cruxMetricsInputBrand]?: true;
};

/** Numeric measurements after runtime validation has stripped invalid values. */
export type CruxParsedMetrics = Partial<Record<CruxMetricKey, number>>;

export interface CruxGenerationCallAttributes {
  mode?: "text" | "object" | "messages";
  temperature?: number;
  finishReason?: string;
}

export interface CruxGenerationStreamAttributes {
  mode?: "text" | "object" | "messages";
  ttftMs?: number;
  chunksReceived?: number;
  tokensPerSecond?: number;
  finishReason?: string;
}

/**
 * One physical provider stream invocation nested under the single logical
 * `generation.stream`. A coordinated stream (RFC #173) can run several: the
 * initial call plus corrective retries. Never carries candidate content or
 * corrective feedback — only attempt identity, cause, and outcome.
 */
export interface CruxGenerationStreamAttemptAttributes {
  attemptIndex: number;
  cause: "initial" | "constraint-retry" | "validation-retry";
  outcome?: "accepted" | "discarded" | "failed" | "cancelled";
  /** Sanitized ids of the policies that discarded this attempt (never feedback text). */
  failedPolicies?: readonly string[];
}

export interface CruxPromptResolveAttributes {
  contextCount?: number;
  droppedContextCount?: number;
  excludedContextCount?: number;
}

/** Payload-free lifecycle evidence for one accepted memory capture. */
export interface CruxMemoryCaptureAttributes {
  readonly memoryId: string;
  readonly operation: "turn" | "tool-event";
  readonly requestedMode: "inline" | "deferred";
  readonly disposition:
    | "inline"
    | "inline-fallback"
    | "retained"
    | "eval-captured";
  readonly sequence: number;
  readonly blockCount: number;
  readonly toolEventCount: number;
  readonly outcome?: "completed" | "failed" | "captured";
  readonly code?: string;
}

/** Attributes known before the capture scheduler returns its disposition. */
export type CruxMemoryCaptureStartAttributes = Omit<
  CruxMemoryCaptureAttributes,
  "disposition" | "outcome" | "code"
> & {
  readonly disposition?: never;
  readonly outcome?: never;
  readonly code?: never;
};

/** Valid attribute states across a `memory.capture` span lifecycle. */
export type CruxMemoryCaptureSpanAttributes =
  | CruxMemoryCaptureStartAttributes
  | CruxMemoryCaptureAttributes;

/**
 * Attributes recorded when public deferred work is accepted.
 *
 * `intentState` is used for named durable work; inline registrations close
 * immediately after acceptance and leave it unset.
 *
 * `definitionId` is reserved for a future compiler-runtime Catalog join. The
 * Runtime acceptance path does not invent a definition id when none is known.
 */
export interface CruxDeferScheduledAttributes {
  mode: "inline" | "named" | "inline-captured" | "named-captured";
  sequence: number;
  definitionId?: string;
  targetId?: string;
  workId?: string;
  intentState?: "staged" | "released" | "abandoned";
  scopeId?: string;
  /** JSON snapshot retained only for named capture-policy evidence. */
  input?: unknown;
}

/**
 * Attributes recorded while a deferred callback or named target executes.
 *
 * Execution is causally linked to its `defer.scheduled` span rather than
 * temporally nested under a closed response span.
 *
 * `definitionId` is reserved for a future compiler-runtime Catalog join and is
 * not fabricated by Runtime wake evidence.
 */
export interface CruxDeferRunAttributes {
  mode: "inline" | "named";
  sequence: number;
  definitionId?: string;
  targetId?: string;
  workId?: string;
  scopeId?: string;
  outcome?: "completed" | "failed" | "timed-out" | "cancelled";
  queueDelayMs?: number;
}

/** Terminal outcome summarized for a custom effect receipt. */
export type CruxEffectOutcome =
  | "succeeded"
  | "failed"
  | "cancelled"
  | "unknown";

/** Recovery availability summarized for a custom effect receipt. */
export type CruxEffectRecoveryAvailability =
  | "available"
  | "unavailable"
  | "irreversible"
  | "expired"
  | "conflict"
  | "handler_unavailable"
  | "ambiguous"
  | "recovered";

/** Safe domain resource identity attached to effect telemetry. */
export interface CruxEffectResourceSummary {
  /** Domain resource type. */
  readonly type: string;
  /** Stable resource identifier. */
  readonly id?: string;
  /** Resource namespace. */
  readonly namespace?: string;
  /** Safe scalar facets selected by the effect definition. */
  readonly attributes?: Readonly<
    Record<string, string | number | boolean>
  >;
}

/** Privacy-safe artifact preview for one settled custom effect receipt. */
export interface CruxEffectReceiptSummary {
  /** Preview discriminant. */
  readonly kind: "effect.receipt";
  /** Stable receipt identifier. */
  readonly receiptId: string;
  /** Authored effect definition identifier. */
  readonly effectId: string;
  /** Effect definition version. */
  readonly effectVersion: number;
  /** Nearest non-boundary scope identifier. */
  readonly scopeId: string;
  /** Owning rollback boundary identifier. */
  readonly boundaryId: string;
  /** Original receipt identifier for a recovery attempt. */
  readonly parentReceiptId?: string;
  /** Terminal execution outcome. */
  readonly outcome: CruxEffectOutcome;
  /** Recovery availability at settlement. */
  readonly recovery: CruxEffectRecoveryAvailability;
  /** Safe domain resource projection. */
  readonly resource?:
    | CruxEffectResourceSummary
    | readonly CruxEffectResourceSummary[];
}

/** Canonical wire attributes for an `effect.run` span. */
export interface CruxEffectRunAttributes extends CruxAttributes {
  /** Authored effect definition identifier. */
  readonly "crux.effect.id": string;
  /** Effect definition version. */
  readonly "crux.effect.version": number;
  /** Stable receipt identifier. */
  readonly "crux.effect.receipt.id": string;
  /** Nearest non-boundary scope identifier. */
  readonly "crux.effect.scope.id": string;
  /** Owning rollback boundary identifier. */
  readonly "crux.effect.boundary.id": string;
  /** Original receipt identifier for a recovery attempt. */
  readonly "crux.effect.parent_receipt.id"?: string;
  /** Receipt outcome at the point represented by the record. */
  readonly "crux.effect.outcome":
    | "preparing"
    | "running"
    | CruxEffectOutcome;
  /** Recovery availability at the point represented by the record. */
  readonly "crux.effect.recovery": CruxEffectRecoveryAvailability;
}

/** Payload-free structural evidence for one Thread operation or I/O decision. */
export interface CruxThreadOperationAttributes {
  readonly threadId: string;
  readonly operation:
    | "append"
    | "read"
    | "edit"
    | "select"
    | "redact"
    | "delete"
    | "history.override";
}

export type CruxSpanAttributesByPrimitive = {
  "generation.call": CruxGenerationCallAttributes;
  "generation.stream": CruxGenerationStreamAttributes;
  "generation.stream.attempt": CruxGenerationStreamAttemptAttributes;
  "prompt.resolve": CruxPromptResolveAttributes;
  "memory.capture": CruxMemoryCaptureSpanAttributes;
  "defer.scheduled": CruxDeferScheduledAttributes;
  "defer.run": CruxDeferRunAttributes;
  "effect.run": CruxEffectRunAttributes;
  "thread.operation": CruxThreadOperationAttributes;
  "custom.operation": CruxAttributes;
};

/**
 * Attribute shape accepted by a span primitive.
 *
 * Known Crux primitives get their documented keys typed while still allowing
 * integration-specific attributes. Primitives without a specialized attribute
 * interface accept the general `CruxAttributes` record.
 */
export type AttributesFor<P extends CruxPrimitiveName> =
  P extends keyof CruxSpanAttributesByPrimitive
    ? CruxSpanAttributesByPrimitive[P] & CruxAttributes
    : CruxAttributes;

export interface CruxErrorSummary {
  message: string;
  name?: string;
  category?: string;
  retryable?: boolean;
  statusCode?: number;
}

/**
 * Broad telemetry surfaces that can be changed by declarative observability
 * redaction patterns.
 *
 * The constant is the canonical order used by runtime evidence. It
 * intentionally excludes rule details, nested paths, values, replacements,
 * hashes, and counts.
 */
export const CRUX_OBSERVABILITY_REDACTION_SURFACES = [
  'artifact.preview',
  'artifact.uri',
  'attributes',
  'error.message',
] as const

/** A broad telemetry surface affected by declarative pattern redaction. */
export type CruxObservabilityRedactionSurface =
  (typeof CRUX_OBSERVABILITY_REDACTION_SURFACES)[number]

/**
 * Privacy-safe evidence that declarative patterns changed this telemetry
 * record. It never describes the rule or matched value.
 */
export interface CruxObservabilityRedactionEvidence {
  /** Confirms that at least one configured pattern changed captured telemetry. */
  readonly applied: true
  /** Deduplicated affected surfaces in canonical constant order. */
  readonly surfaces: readonly CruxObservabilityRedactionSurface[]
}

/**
 * Base identity carried by every newly written observability graph record.
 *
 * Writers and readers use the current version. Older records cannot be given
 * truthful operation-family identity and are rejected at this boundary.
 * `segmentSeq` is monotonic only within `segmentId`; consumers must not treat
 * it as a distributed per-run order.
 */
interface CruxRecordBase {
  schemaVersion: typeof CRUX_OBSERVABILITY_SCHEMA_VERSION;
  recordId: CruxRecordId;
  /** Root run id for the user-visible operation family. */
  operationId: CruxRunId;
  runId: CruxRunId;
  segmentId: CruxSegmentId;
  /** Positive monotonic sequence scoped only to segmentId. */
  segmentSeq: number;
  sessionId?: string;
  userId?: string;
  traceId?: CruxTraceId;
  /** Immutable deployment identity captured when the logical run starts. */
  deployment?: CruxDeploymentIdentity;
  /** Runtime-owned, privacy-safe declarative-redaction evidence. */
  privacy?: {
    readonly redaction: CruxObservabilityRedactionEvidence
  }
}

export interface CruxRunStartRecord extends CruxRecordBase {
  type: "run:start";
  /** Immediate lifecycle parent. Absent only on the operation root. */
  parentRunId?: CruxRunId;
  /** Exact parent span that caused this child lifecycle. */
  triggeredBySpanId?: CruxSpanId;
  name: string;
  rootPrimitive: CruxPrimitiveName;
  startedAt: string;
  status: Extract<CruxRunStatus, "running">;
  attributes?: CruxAttributes;
  source?: CruxSourceLocation;
  definitionRefs?: DefinitionRef[];
}

/** Non-terminal boundary that closes one physical execution segment. */
export interface CruxRunSuspendRecord extends CruxRecordBase {
  type: "run:suspend";
  suspendedAt: string;
  reason: string;
  attributes?: CruxAttributes;
}

/** First record emitted by a fresh segment continuing an existing logical run. */
export interface CruxRunResumeRecord extends CruxRecordBase {
  type: "run:resume";
  resumedAt: string;
  reason: string;
  previousSegmentId?: CruxSegmentId;
  attributes?: CruxAttributes;
}

export interface CruxRunEndRecord extends CruxRecordBase {
  type: "run:end";
  endedAt: string;
  durationMs?: number;
  status: Exclude<CruxRunStatus, "running">;
  metrics?: CruxParsedMetrics;
  error?: CruxErrorSummary;
  attributes?: CruxAttributes;
}

/** Canonical logical-run boundaries across one or more execution segments. */
export type CruxRunLifecycleRecord =
  | CruxRunStartRecord
  | CruxRunSuspendRecord
  | CruxRunResumeRecord
  | CruxRunEndRecord;

export interface CruxSpanStartRecord extends CruxRecordBase {
  type: "span:start";
  spanId: CruxSpanId;
  parentSpanId?: CruxSpanId | null;
  family: CruxPrimitiveFamily;
  primitive: CruxPrimitiveName;
  name: string;
  startedAt: string;
  status: Extract<CruxSpanStatus, "running">;
  model?: string;
  provider?: string;
  promptId?: string;
  contextId?: string;
  agentId?: string;
  toolName?: string;
  flowId?: string;
  stepId?: string;
  memoryId?: string;
  retrieverId?: string;
  attributes?: CruxAttributes;
  source?: CruxSourceLocation;
  definitionRefs?: DefinitionRef[];
}

export interface CruxSpanEndRecord extends CruxRecordBase {
  type: "span:end";
  spanId: CruxSpanId;
  endedAt: string;
  durationMs?: number;
  status: Exclude<CruxSpanStatus, "running">;
  metrics?: CruxParsedMetrics;
  error?: CruxErrorSummary;
  attributes?: CruxAttributes;
}

export interface CruxSpanRecord extends CruxRecordBase {
  type: "span";
  spanId: CruxSpanId;
  parentSpanId?: CruxSpanId | null;
  family: CruxPrimitiveFamily;
  primitive: CruxPrimitiveName;
  name: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  status: Exclude<CruxSpanStatus, "running">;
  metrics?: CruxParsedMetrics;
  error?: CruxErrorSummary;
  attributes?: CruxAttributes;
  source?: CruxSourceLocation;
  definitionRefs?: DefinitionRef[];
}

export interface CruxSpanEventRecord extends CruxRecordBase {
  type: "span:event";
  spanId: CruxSpanId;
  eventId: CruxSpanEventId;
  name: string;
  timestamp: string;
  attributes?: CruxAttributes;
}

export type CruxGraphNodeRef =
  | { kind: "run"; id: CruxRunId }
  | { kind: "span"; id: CruxSpanId }
  | { kind: "artifact"; id: CruxArtifactId };

export interface CruxEdgeRecord extends CruxRecordBase {
  type: "edge";
  edgeId: CruxEdgeId;
  edgeType: CruxEdgeType;
  from: CruxGraphNodeRef;
  to: CruxGraphNodeRef;
  createdAt: string;
  attributes?: CruxAttributes;
}

export interface CruxArtifactRecord extends CruxRecordBase {
  type: "artifact";
  artifactId: CruxArtifactId;
  spanId?: CruxSpanId;
  kind: CruxArtifactKind;
  createdAt: string;
  contentType: string;
  encoding: "json" | "text" | "bytes" | "reference";
  sizeBytes?: number;
  hash?: string;
  preview?: unknown;
  uri?: string;
  attributes?: CruxAttributes;
}

export type CruxGraphRecord =
  | CruxRunStartRecord
  | CruxRunSuspendRecord
  | CruxRunResumeRecord
  | CruxRunEndRecord
  | CruxSpanStartRecord
  | CruxSpanEndRecord
  | CruxSpanRecord
  | CruxSpanEventRecord
  | CruxEdgeRecord
  | CruxArtifactRecord;

export interface CruxGraphRecordBatch {
  records: CruxGraphRecord[];
}
