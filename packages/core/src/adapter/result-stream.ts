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
import { createResultAccumulator } from "./result-accumulator";
import { createCanonicalPartialProjector } from "./execution/canonical-partials";
import { publishOrdinaryStream } from "./execution/logical-stream-mapping";
import type { PublishedStreamEvent, StreamResult } from "./logical-stream";
import type { StreamCompletion } from "./stream-result-types";

/**
 * Build the public logical stream from an internal provider stream handle.
 *
 * @remarks
 * This is the single place the native route becomes a logical stream, so the
 * publication laws are enforced once rather than per provider. The handle's
 * physical chunk protocol stops here: nothing downstream of this function can
 * observe provider framing or the provider stream object.
 */
export function createStreamResult<
  TRawStream,
  TOutput = unknown,
  TPartial = unknown,
>(
  handle: WithOperationResultMeta<StreamHandle<TRawStream>> &
    Readonly<{ runId: CruxRunId }>,
): StreamResult<TOutput, TPartial> {
  let streamedText = "";

  // Memoized so the event source and the completion envelope observe ONE
  // provider completion: the derived terminal events and the envelope must
  // describe the same finished attempt.
  let metaPromise: Promise<StreamCompletionMetadata | undefined> | undefined;
  const getMeta = (): Promise<StreamCompletionMetadata | undefined> => {
    metaPromise ??= handle.completion();
    void metaPromise.catch(() => undefined);
    return metaPromise;
  };

  async function* events(): AsyncIterable<PublishedStreamEvent<TPartial>> {
    const partials = handle.structured
      ? createCanonicalPartialProjector()
      : undefined;
    try {
      for await (const chunk of handle.rawStream as AsyncIterable<unknown>) {
        const delta = handle.extractTextDelta(chunk);
        if (delta === undefined || delta === "") continue;
        streamedText += delta;
        yield { type: "text-delta", text: delta };
        const partial = partials?.push(delta);
        if (partial) {
          yield { type: "partial-output", value: partial.value as TPartial };
        }
      }
    } catch (error) {
      throw attachStreamRouting(error, handle.routing);
    }
    // A native provider's only progressive channel is text, so its non-text output
    // becomes observable when the attempt's buffered content does. Publishing it
    // here — after the deltas, before the logical `finish` — keeps the contract's
    // rule that tool inputs and media appear only once structurally complete,
    // without inventing progressive framing the provider never gave us.
    //
    // Because this content is the GUARDED completion, the native route needs no
    // `deferMedia` decision: a part a terminal `model.output` or output-media
    // guard stripped is simply absent here. The SDK route, which does have a
    // progressive media channel, makes that choice explicitly.
    yield* terminalEvents<TPartial>(await getMeta());
  }

  const completion = async (): Promise<StreamCompletion<TOutput>> => {
    const meta = await getMeta();
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
      // Present only when the operation spanned several billable attempts; it
      // then replaces the step-derived totals (RFC #173, law 7).
      ...(meta?.logicalTotals !== undefined
        ? { logicalTotals: meta.logicalTotals }
        : {}),
      _meta: completionMetadata(meta),
    });
    return stampCruxRunId(
      withOperationResultMeta(payload, handle._meta),
      handle.runId,
    ) as StreamCompletion<TOutput>;
  };

  return publishOrdinaryStream<TOutput, TPartial>({
    runId: handle.runId,
    meta: handle._meta,
    events: events(),
    completion,
    ...(handle.abort ? { onCancel: handle.abort } : {}),
    ...(handle.signal ? { signal: handle.signal } : {}),
  });
}

/**
 * Derive the non-text logical events a completed native attempt carries.
 *
 * @remarks
 * Text parts are deliberately skipped: they were already published as deltas,
 * and republishing them would duplicate the operation's output.
 */
function* terminalEvents<TPartial>(
  meta: StreamCompletionMetadata | undefined,
): Generator<PublishedStreamEvent<TPartial>> {
  const extended = meta as (typeof meta & StreamOutputMeta<unknown>) | undefined;
  for (const part of meta?.content ?? []) {
    const event = contentEvent<TPartial>(part);
    if (event) yield event;
  }
  for (const approval of extended?.pendingApprovals ?? []) {
    yield {
      type: "tool-approval-request",
      toolCallId: approval.toolCallId,
      toolName: approval.toolName,
      input: approval.input,
    };
  }
}

function contentEvent<TPartial>(
  part: AssistantContentPart,
): PublishedStreamEvent<TPartial> | undefined {
  if (part.type === "text") return undefined;
  if (part.type === "reasoning") {
    return { type: "reasoning-delta", text: part.text };
  }
  if (part.type === "tool-call") {
    return {
      type: "tool-call",
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      input: part.input,
    };
  }
  return { type: "media", part };
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
