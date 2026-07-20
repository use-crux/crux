/** Canonical stream-result assembly. @internal */

import type { Message } from "../generation/messages";
import type { GenerationMeta } from "../generation/types";
import type { AssistantContentPart } from "../types/content";
import type { ApprovalRequestInfo } from "./tool/approval";
import type { StreamCompletionMetadata, StreamHandle } from "./types";
import type { CruxRunId } from "../observability";
import type { WithOperationResultMeta } from "../observability";
import { withOperationResultMeta } from "../observability/internal/result-meta";
import { stampCruxRunId } from "../generation/run-id";
import {
  attachRoutingToError,
  markRoutingMidStreamFailure,
  type RoutingReceipt,
} from "../routing/receipt";
import {
  createResultAccumulator,
} from "./result-accumulator";
import type { StreamCompletion, StreamResult } from "./stream-result-types";

/** Build the public stream envelope from an internal provider stream handle. */
export function createStreamResult<TRawStream, TOutput = unknown>(
  handle: WithOperationResultMeta<StreamHandle<TRawStream>> &
    Readonly<{ runId: CruxRunId }>,
): StreamResult<TRawStream, TOutput> {
  let streamedText = "";
  let resolveStream: (() => void) | undefined;
  let rejectStream: ((error: unknown) => void) | undefined;
  const streamFinished = new Promise<void>((resolve, reject) => {
    resolveStream = resolve;
    rejectStream = reject;
  });

  async function* textStream(): AsyncIterable<string> {
    try {
      for await (const chunk of handle.rawStream as AsyncIterable<unknown>) {
        const delta = handle.extractTextDelta(chunk);
        if (delta === undefined || delta === "") continue;
        streamedText += delta;
        yield delta;
      }
      resolveStream?.();
    } catch (error) {
      const routedError = attachStreamRouting(error, handle.routing);
      rejectStream?.(routedError);
      throw routedError;
    }
  }

  const completion = (async (): Promise<StreamCompletion<TOutput>> => {
    await streamFinished;
    const meta = await handle.completion();
    const text = typeof meta?.text === "string" ? meta.text : streamedText;
    const accumulator = createResultAccumulator();
    accumulator.addStep({
      content:
        meta?.content !== undefined ? meta.content : [{ type: "text", text }],
      ...(meta?.usage !== undefined ? { usage: meta.usage } : {}),
      finishReason: meta?.finishReason,
      ...(meta?.toolCalls !== undefined ? { toolCalls: meta.toolCalls } : {}),
      responseId: meta?.responseId,
      modelId: meta?.actualModelId,
      ...(meta?.warnings !== undefined ? { warnings: meta.warnings } : {}),
      ...(meta?.providerMetadata !== undefined
        ? { providerMetadata: meta.providerMetadata }
        : {}),
    });
    const extended = meta as typeof meta & StreamOutputMeta<TOutput>;
    const payload = accumulator.finalizeCompletion({
      messages: meta?.messages ? [...meta.messages] : [],
      ...(extended?.object !== undefined ? { object: extended.object } : {}),
      ...(meta?.cost !== undefined ? { cost: meta.cost } : {}),
      ...(extended?.pendingApprovals
        ? { pendingApprovals: extended.pendingApprovals }
        : {}),
      ...(handle.routing !== undefined ? { routing: handle.routing } : {}),
      _meta: completionMetadata(meta),
    });
    return stampCruxRunId(
      withOperationResultMeta(payload, handle._meta),
      handle.runId,
    );
  })();
  void completion.catch(() => undefined);

  return {
    runId: handle.runId,
    textStream: textStream(),
    raw: handle.raw ?? handle.rawStream,
    completion,
    _meta: handle._meta,
  };
}

interface StreamOutputMeta<TOutput> {
  readonly object?: TOutput;
  readonly messages?: readonly Message[];
  readonly content?: readonly AssistantContentPart[];
  readonly pendingApprovals?: readonly ApprovalRequestInfo[];
}

function completionMetadata(
  meta: StreamCompletionMetadata | undefined,
): GenerationMeta {
  if (!meta) return {};
  return {
    ...(meta.usage !== undefined ? { usage: meta.usage } : {}),
    ...(meta.cost !== undefined ? { cost: meta.cost } : {}),
    ...(meta.finishReason !== undefined ? { finishReason: meta.finishReason } : {}),
    ...(meta.stoppedBy !== undefined ? { stoppedBy: meta.stoppedBy } : {}),
    ...(meta.toolCalls !== undefined ? { toolCalls: meta.toolCalls } : {}),
    ...(meta.responseId !== undefined ? { responseId: meta.responseId } : {}),
    ...(meta.actualModelId !== undefined ? { actualModelId: meta.actualModelId } : {}),
    ...(meta.constraints !== undefined ? { constraints: meta.constraints } : {}),
    ...(meta.guardrails !== undefined ? { guardrails: meta.guardrails } : {}),
  };
}

function attachStreamRouting(
  error: unknown,
  routing: RoutingReceipt | undefined,
): unknown {
  if (routing === undefined) return error;
  const routed = markRoutingMidStreamFailure(routing);
  if (error instanceof Error) return attachRoutingToError(error, routed);
  return attachRoutingToError(new Error(String(error)), routed);
}
