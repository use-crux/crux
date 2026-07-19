import type {
  CitationValidationResult,
  CompactionResult,
  CorpusSyncResult,
  FlowResult,
  GenerateResult,
  GenerationMeta,
  IndexDryRunResult,
  IndexResult,
  OperationResultMeta,
  OperationRunRef,
  TraceMeta,
  WithOperationResultMeta as RootWithOperationResultMeta,
} from "@use-crux/core";
import type {
  CruxRunId,
  CruxSpanId,
  CruxTraceId,
  OperationResultMeta as ObservabilityOperationResultMeta,
  OperationRunRef as ObservabilityOperationRunRef,
  WithOperationResultMeta,
} from "@use-crux/core/observability";
import type {
  GenerateResultPayload,
  ExecutorProviderStreamHandle,
  ExecutorStreamCompletionPayload,
  ExecutorStreamHandle,
  ExecutorStreamMeta,
  StreamCompletion,
  StreamCompletionPayload,
  StreamResult,
} from "@use-crux/core/adapter";
import type {
  ConsensusResult,
  DelegateResult,
  HandoffPayload,
  SwarmResult,
} from "@use-crux/core/agent";
import type { JudgeResult } from "@use-crux/core/scoring";

declare const traceId: CruxTraceId;
declare const spanId: CruxSpanId;
declare const runId: CruxRunId;
declare const operationMeta: OperationResultMeta;
declare const compactionResult: CompactionResult;
declare const citationResult: CitationValidationResult;
declare const corpusSyncResult: CorpusSyncResult;
declare const indexResult: IndexResult;
declare const indexDryRunResult: IndexDryRunResult;

const operationTraceId: OperationResultMeta["traceId"] = traceId;
const compactionMeta: OperationResultMeta = compactionResult._meta;
const citationMeta: OperationResultMeta = citationResult._meta;
const corpusSyncMeta: OperationResultMeta = corpusSyncResult._meta;
const indexMeta: OperationResultMeta = indexResult._meta;
const indexDryRunMeta: OperationResultMeta = indexDryRunResult._meta;

// @ts-expect-error Authored trace IDs must use the Crux trace brand.
const plainTraceId: OperationResultMeta["traceId"] = "trace";

const operationSpanId: OperationResultMeta["spanId"] = spanId;

// @ts-expect-error Trace and span IDs are distinct brands.
const traceAsSpanId: OperationResultMeta["spanId"] = traceId;

// @ts-expect-error Authored span IDs must use the Crux span brand.
const plainSpanId: OperationResultMeta["spanId"] = "span";

void operationTraceId;
void compactionMeta;
void citationMeta;
void corpusSyncMeta;
void indexMeta;
void indexDryRunMeta;
void plainTraceId;
void operationSpanId;
void traceAsSpanId;
void plainSpanId;

const observabilityOperationMeta: ObservabilityOperationResultMeta =
  operationMeta;

void observabilityOperationMeta;

const runRef: OperationRunRef = { runId, traceId };
const observabilityRunRef: ObservabilityOperationRunRef = runRef;

// @ts-expect-error Logical run and trace IDs are distinct brands.
const runAsTraceId: OperationRunRef = { runId, traceId: runId };
// @ts-expect-error Durable run references are readonly.
runRef.runId = runId;

void runAsTraceId;
void observabilityRunRef;

const correlated: RootWithOperationResultMeta<{ readonly value: number }> = {
  value: 1,
  _meta: { traceId, spanId },
};

// @ts-expect-error Correlated result metadata is required.
const missingMeta: WithOperationResultMeta<{ readonly value: number }> = {
  value: 1,
};

// @ts-expect-error Correlated result metadata is readonly.
correlated._meta.traceId = traceId;

void missingMeta;

type ResultWithProviderMeta = WithOperationResultMeta<{
  readonly value: number;
  readonly _meta: { readonly responseId: string };
}>;

const providerResponseId: ResultWithProviderMeta["_meta"]["responseId"] =
  "provider-response";

void providerResponseId;

type ResultWithForgedMeta = WithOperationResultMeta<{
  readonly value: number;
  readonly _meta: {
    readonly traceId: "forged-trace";
    readonly spanId: "forged-span";
  };
}>;

const replacedTraceId: ResultWithForgedMeta["_meta"]["traceId"] = traceId;
const replacedSpanId: ResultWithForgedMeta["_meta"]["spanId"] = spanId;

void replacedTraceId;
void replacedSpanId;

type CorrelatedStatus = WithOperationResultMeta<
  | { readonly status: "complete"; readonly value: number }
  | { readonly status: "suspended"; readonly token: string }
>;

function readCorrelatedStatus(result: CorrelatedStatus): number | string {
  if (result.status === "complete") return result.value;
  return result.token;
}

void readCorrelatedStatus;

declare const generateResult: GenerateResult<unknown>;

const generationMeta: GenerationMeta = generateResult._meta;
const generationTraceId: CruxTraceId = generateResult._meta.traceId;
const generationSpanId: CruxSpanId = generateResult._meta.spanId;

void generationMeta;
void generationTraceId;
void generationSpanId;

const payloadMeta: GenerateResultPayload<unknown>["_meta"] = {
  responseId: "provider-response",
};

void payloadMeta;

declare const legacyTraceMeta: TraceMeta;
const compatibleGenerationMeta: GenerationMeta = legacyTraceMeta;

void compatibleGenerationMeta;

declare const streamResult: StreamResult<AsyncIterable<unknown>>;
declare const streamCompletion: StreamCompletion;

const immediateStreamMeta: OperationResultMeta = streamResult._meta;
const completionTraceId: CruxTraceId = streamCompletion._meta.traceId;
const completionSpanId: CruxSpanId = streamCompletion._meta.spanId;
const completionPayloadMeta: StreamCompletionPayload["_meta"] = {
  responseId: "provider-response",
};

// @ts-expect-error Immediate stream identity is readonly.
streamResult._meta.spanId = spanId;

void immediateStreamMeta;
void completionTraceId;
void completionSpanId;
void completionPayloadMeta;

const executorCompletionPayload: ExecutorStreamCompletionPayload = {
  responseId: "provider-response",
};
const executorProviderHandle: ExecutorProviderStreamHandle<object> = {
  raw: {},
  completion: async () => executorCompletionPayload,
};
const executorCompletionMeta: ExecutorStreamMeta = {
  runId,
  responseId: "provider-response",
  _meta: operationMeta,
};
const executorStreamHandle: ExecutorStreamHandle<object> = {
  runId,
  raw: {},
  _meta: operationMeta,
  completion: async () => executorCompletionMeta,
};

// @ts-expect-error Provider completion payloads do not expose Crux IDs.
executorCompletionPayload.traceId;

// @ts-expect-error Provider completion payloads do not expose Crux span IDs.
executorCompletionPayload.spanId;

// @ts-expect-error Provider handles do not expose observed operation metadata.
executorProviderHandle._meta;

// @ts-expect-error Public executor handles require immediate operation identity.
const missingExecutorHandleMeta: ExecutorStreamHandle<object> = {
  raw: {},
  completion: async () => executorCompletionMeta,
};

void executorProviderHandle;
void executorStreamHandle;
void missingExecutorHandleMeta;

declare const consensusResult: ConsensusResult;
declare const delegateResult: DelegateResult<unknown>;
declare const flowResult: FlowResult<number>;
declare const handoffPayload: HandoffPayload<unknown>;
declare const swarmResult: SwarmResult;
declare const judgeResult: JudgeResult;

const consensusMeta: OperationResultMeta = consensusResult._meta;
const delegateMeta: OperationResultMeta = delegateResult._meta;
const flowMeta: OperationResultMeta = flowResult._meta;
const swarmMeta: OperationResultMeta = swarmResult._meta;
const judgeMeta: OperationResultMeta = judgeResult._meta;

void consensusMeta;
void delegateMeta;
void flowMeta;
void swarmMeta;
void judgeMeta;

function readFlowResult(result: FlowResult<number>): number | string {
  switch (result.status) {
    case "completed":
      return result.output;
    case "suspended":
    case "expired":
      return result.suspendedAt;
    case "cancelled":
      return result.cancelReason ?? result.flowId;
  }
}

void readFlowResult;

// @ts-expect-error Completed flow results require current operation metadata.
const completedFlowWithoutMeta: FlowResult<number> = {
  status: "completed",
  output: 1,
  flowId: "flow-completed",
};

// @ts-expect-error Suspended flow results require current operation metadata.
const suspendedFlowWithoutMeta: FlowResult<number> = {
  status: "suspended",
  flowId: "flow-suspended",
  suspendedAt: "approval",
};

// @ts-expect-error Cancelled flow results require current operation metadata.
const cancelledFlowWithoutMeta: FlowResult<number> = {
  status: "cancelled",
  flowId: "flow-cancelled",
};

// @ts-expect-error Expired flow results require current operation metadata.
const expiredFlowWithoutMeta: FlowResult<number> = {
  status: "expired",
  flowId: "flow-expired",
  suspendedAt: "approval",
};

void completedFlowWithoutMeta;
void suspendedFlowWithoutMeta;
void cancelledFlowWithoutMeta;
void expiredFlowWithoutMeta;

// @ts-expect-error Flow result metadata contains no logical run id.
void flowResult._meta.runId;

// @ts-expect-error Flow result metadata contains no physical segment id.
void flowResult._meta.segmentId;

// @ts-expect-error Handoff payloads remain unobserved domain values.
void handoffPayload._meta;

// @ts-expect-error Operation metadata is immutable on public result envelopes.
consensusResult._meta = operationMeta;
