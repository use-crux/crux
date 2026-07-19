import type {
  AgentExecutor,
  AgentResult,
  AgentResultPayload,
  ParallelResult,
  PipelineResult,
} from "@use-crux/core/agent";
import type {
  CruxSpanId,
  CruxTraceId,
  OperationResultMeta,
} from "@use-crux/core/observability";

declare const executorResult: Awaited<ReturnType<AgentExecutor>>;
declare const payload: AgentResultPayload<{ readonly verdict: "approved" }>;
declare const result: AgentResult<{ readonly verdict: "approved" }>;
declare const parallelResult: ParallelResult<{
  readonly reviewer: AgentResult<{ readonly verdict: "approved" }>;
}>;
declare const pipelineResult: PipelineResult<{ readonly verdict: "approved" }>;
declare const traceId: CruxTraceId;
declare const spanId: CruxSpanId;

const executorPayload: AgentResultPayload = executorResult;
const resultMeta: OperationResultMeta = result._meta;
const parallelMeta: OperationResultMeta = parallelResult._meta;
const pipelineMeta: OperationResultMeta = pipelineResult._meta;

void payload.agentId;
void payload.output.verdict;
void payload.durationMs;
void payload.usage;
void result.output.verdict;
void executorPayload;
void resultMeta;
void parallelMeta;
void pipelineMeta;

// @ts-expect-error Executor payloads never contain core-owned operation identity.
void executorResult._meta;

// @ts-expect-error Agent payloads are not observed result envelopes.
void payload._meta;

// @ts-expect-error Executor payload facts are readonly.
payload.durationMs = 5;

// @ts-expect-error Observed operation identity is readonly.
result._meta.traceId = traceId;

// @ts-expect-error Observed operation identity is readonly.
result._meta.spanId = spanId;
