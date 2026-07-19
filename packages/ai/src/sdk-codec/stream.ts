import type { LanguageModel, StopCondition, ToolSet } from "ai";
import type { z } from "zod";
import { getHooks } from "@use-crux/core";
import { observe } from "@use-crux/core/observability";
import type {
  ExecutorRequest,
  ExecutorStreamCompletionPayload,
} from "@use-crux/core/adapter";
import type { SdkGateway } from "../gateway";
import { extractCost, normalizeUsage } from "../meta";
import { sanitizeSchemaForProvider } from "../provider-profile";
import { buildBaseArgs } from "./request-args";
import { withLegacyStreamMeta } from "./stream-meta";
import { createSafetyStreamTransform } from "./stream-safety";
import { withToolCallRepair } from "./tool-call-repair";
import type {
  AiSdkStreamPlan,
  SdkStreamChunkEvent,
  SdkStreamFinishEvent,
  SdkStreamResultLike,
} from "./types";
import { decodeAssistantContentFromAiSdkParts } from "../assistant-content";
import { fromResponseMessages } from "../messages";

interface StreamPlanDeps {
  readonly clock: () => number;
}

let warnedStructuredStreamToolsConsole = false;

/**
 * Plan one AI SDK stream call and the handle attachment that preserves the
 * raw SDK stream result.
 *
 * The plan owns SDK callbacks, caller callback chaining, stream-progress
 * hooks, safety transforms, completion metadata, and legacy completion
 * metadata placement.
 *
 * @internal
 */
export async function createStreamCallPlan(
  request: ExecutorRequest<LanguageModel> & { readonly schema?: z.ZodType },
  deps: StreamPlanDeps,
): Promise<AiSdkStreamPlan> {
  const args = buildBaseArgs(request, { includeTools: !request.schema });
  if (!request.schema) {
    withToolCallRepair(args);
    const explicitStop = (request.extra?.stopWhen ??
      request.settings.stopWhen) as
      | StopCondition<ToolSet>
      | StopCondition<ToolSet>[]
      | undefined;
    args.stopWhen =
      explicitStop ??
      ((({ steps }) =>
        steps.length >= request.maxSteps) satisfies StopCondition<ToolSet>);
  }

  const streamStartTime = deps.clock();
  let firstChunkTime: number | undefined;
  let chunkCount = 0;

  const callerOnChunk = request.extra?.onChunk as
    | ((event: SdkStreamChunkEvent) => unknown)
    | undefined;
  const callerOnFinish = request.extra?.onFinish as
    | ((event: SdkStreamFinishEvent) => unknown)
    | undefined;

  let resolveCompletion!: (meta: ExecutorStreamCompletionPayload) => void;
  let rejectCompletion!: (error: unknown) => void;
  const completionPromise = new Promise<ExecutorStreamCompletionPayload>(
    (resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    },
  );
  completionPromise.catch(() => {
    // Callers may only consume textStream. Keep the original promise rejecting
    // for callers that await completion, but mark it observed for runtimes that
    // report unhandled rejections eagerly.
  });

  if (request.schema) {
    warnForStructuredStreamTools(request);
    args.schema = await sanitizeSchemaForProvider(
      request.schema,
      request.modelInfo,
    );
    args.onFinish = async (event: SdkStreamFinishEvent) => {
      try {
        const content = event.content
          ? decodeAssistantContentFromAiSdkParts(event.content)
          : undefined;
        resolveCompletion({
          ...(event.object !== undefined ? { object: event.object } : {}),
          usage: normalizeUsage(event.usage),
          finishReason: event.finishReason,
          responseId: event.response?.id,
          actualModelId: event.response?.modelId,
          cost: extractCost(event.providerMetadata),
          text: event.text,
          ...(event.object !== undefined ? { object: event.object } : {}),
          ...(content !== undefined && (content.length > 0 || !event.text)
            ? { content }
            : {}),
          ...(event.response?.messages !== undefined
            ? { messages: fromResponseMessages(event.response.messages) }
            : {}),
          ...(event.warnings !== undefined ? { warnings: event.warnings } : {}),
          ...(event.providerMetadata !== undefined
            ? { providerMetadata: event.providerMetadata }
            : {}),
          streaming: {
            ttftMs:
              firstChunkTime != null
                ? firstChunkTime - streamStartTime
                : undefined,
            totalChunks: chunkCount,
          },
        });
        await callerOnFinish?.(event);
      } catch (error) {
        rejectCompletion(error);
      }
    };
    return {
      method: "streamObject",
      args: args as Parameters<SdkGateway["streamObject"]>[0],
      attach(raw) {
        return attachStreamResult(
          raw as unknown as SdkStreamResultLike,
          completionPromise,
        );
      },
    };
  }

  const traceId = observe.captureContext()?.traceId;
  const progress = traceId
    ? getHooks().streamProgressHook?.(traceId)
    : undefined;

  if (request.safety) {
    args.experimental_transform = createSafetyStreamTransform(request.safety, {
      onError: (error, source) => {
        progress?.dispose();
        if (source === "finish") rejectCompletion(error);
      },
    });
  }

  args.onChunk = async (event: SdkStreamChunkEvent) => {
    if (!firstChunkTime) firstChunkTime = deps.clock();
    chunkCount++;
    const textDelta =
      event.chunk?.type === "text-delta" ? event.chunk.textDelta : undefined;
    progress?.onChunk(textDelta);
    await callerOnChunk?.(event);
  };
  args.onFinish = async (event: SdkStreamFinishEvent) => {
    try {
      await progress?.flush();
      const durationMs = deps.clock() - streamStartTime;
      const usage = normalizeUsage(event.totalUsage);
      const outputTokens = usage?.outputTokens;
      const tokensPerSecond =
        durationMs > 0 && outputTokens
          ? Math.round((outputTokens / durationMs) * 1000)
          : undefined;
      const content = event.content
        ? decodeAssistantContentFromAiSdkParts(event.content)
        : undefined;

      resolveCompletion({
        usage,
        finishReason: event.finishReason,
        toolCalls:
          event.toolCalls && event.toolCalls.length > 0
            ? event.toolCalls.map((tc) => ({
                id: tc.toolCallId,
                name: tc.toolName,
                args: tc.input ?? tc.args,
              }))
            : undefined,
        responseId: event.response?.id,
        actualModelId: event.response?.modelId,
        cost: extractCost(event.providerMetadata),
        text: event.text,
        ...(content !== undefined && (content.length > 0 || !event.text)
          ? { content }
          : {}),
        ...(event.response?.messages !== undefined
          ? { messages: fromResponseMessages(event.response.messages) }
          : {}),
        ...(event.warnings !== undefined ? { warnings: event.warnings } : {}),
        ...(event.providerMetadata !== undefined
          ? { providerMetadata: event.providerMetadata }
          : {}),
        streaming: {
          ttftMs:
            firstChunkTime != null
              ? firstChunkTime - streamStartTime
              : undefined,
          tokensPerSecond,
          totalChunks: chunkCount,
        },
      });
      await callerOnFinish?.(event);
    } catch (error) {
      progress?.dispose();
      rejectCompletion(error);
    }
  };

  return {
    method: "streamText",
    args: args as Parameters<SdkGateway["streamText"]>[0],
    attach(raw) {
      return attachStreamResult(
        raw as unknown as SdkStreamResultLike,
        completionPromise,
      );
    },
  };
}

/**
 * Warn when a structured stream declares tools.
 *
 * AI SDK v6 `streamObject()` does not expose the text-loop tool event surface
 * (`tools`, `onStepFinish`, tool-call callbacks). Crux therefore cannot offer
 * the same tool observability guarantees for structured streams that it offers
 * for text streams. The call still proceeds without advertising tools.
 * Request diagnostics are emitted for every affected request; the raw console
 * fallback is deduplicated only to avoid repeated process-global noise.
 */
function warnForStructuredStreamTools(
  request: ExecutorRequest<LanguageModel> & { readonly schema?: z.ZodType },
): void {
  if (!request.tools || Object.keys(request.tools).length === 0) return;

  const message =
    "[@use-crux/ai] streaming structured output with tools is not observable in AI SDK streamObject(); tools are omitted for this stream. Use generate() for structured tool loops or stream() without an output schema.";
  if (request.diagnostics) {
    request.diagnostics.warn(message);
    return;
  }
  if (!warnedStructuredStreamToolsConsole) {
    warnedStructuredStreamToolsConsole = true;
    console.warn(message);
  }
}

function attachStreamResult(
  raw: SdkStreamResultLike,
  completionPromise: Promise<ExecutorStreamCompletionPayload>,
) {
  return withLegacyStreamMeta(
    { raw, completion: () => completionPromise },
    completionPromise,
  );
}
