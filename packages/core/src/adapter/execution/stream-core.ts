/**
 * Core-step streaming execution.
 *
 * This module prepares a provider stream for raw SDK adapters, wraps it with
 * Crux stream safety, and captures completion metadata/memory without
 * replacing the provider's raw stream contract.
 *
 * @internal
 * @module
 */

import type { MiddlewareResult } from "../../runtime/types";
import { createSafety } from "../../safety/session";
import { orchestrateStream } from "../../generation/orchestrate";
import { composeAbortSignals, withBudget } from "../../generation/timeout";
import { normalizeInvocationMessages } from "../../content/invocation-message";
import type { CallArgs, StreamHandle } from "../types";
import { createToolLifecycle } from "../tool/session";
import type { AdapterExecutionStreamArgs, CoreStepDialect } from "./types";
import { initialCoreMessages } from "./messages";
import { createCachedStreamHandle } from "./metadata";
import { buildResolveOpts } from "./shared";
import { createSafetyTextChunk, isSafetyTextChunk } from "./stream-safety";
import { emitInputTokenEstimate } from "./media-token-budget";
import { responseContent } from "../assistant-output";
import type { Message } from "../../generation/messages";
import { replaceTextSlots } from "./stream-content";

/**
 * Start one provider stream through the core-owned adapter dialect.
 *
 * The returned handle preserves the provider stream shape while interposing
 * Crux stream safety on text deltas and capturing the completed assistant turn
 * when `completion()` resolves.
 *
 * @param dialect - Normalized core-step dialect for one bound provider client.
 * @param args - Prepared streaming arguments from the public `adapter()` facade.
 * @returns A provider-compatible stream handle.
 */
export async function streamCore<
  TClient,
  TRawResponse,
  TRawStream,
  TExtra extends Record<string, unknown>,
>(
  dialect: CoreStepDialect<TClient, TRawResponse, TRawStream, TExtra>,
  args: AdapterExecutionStreamArgs<string, TExtra>,
): Promise<StreamHandle<TRawStream>> {
  const prompt = args.prompt;
  const modelInfo = args.modelInfo ?? {
    provider: args.provider ?? dialect.id,
    modelId: args.model,
  };
  const resolveOpts = buildResolveOpts({
    input: args.input,
    provider: args.provider ?? modelInfo.provider,
    modelId: modelInfo.modelId,
    tokenBudget: args.tokenBudget,
    settings: args.settings,
  });
  const resolved = await prompt.resolve(resolveOpts);
  const mappedSettings = dialect.mapSettings(resolved.settings);
  const lifecycle = createToolLifecycle({
    regime: "core",
    resolved,
    call: {
      tools: args.tools,
      toolsContext: args.toolsContext,
      runtimeContext: args.runtimeContext,
      toolMiddleware: args.toolMiddleware,
      toolApproval: args.toolApproval,
    },
    promptId: prompt.id,
    input: args.input ?? {},
    timeout: args.timeout,
    appendToolRound: dialect.appendToolRound,
    sanitizeToolSchema: dialect.sanitizeToolSchema,
  });
  const tools = lifecycle.descriptors ? [...lifecycle.descriptors] : undefined;
  let messages = initialCoreMessages(resolved, args.messages);
  messages = (await lifecycle.resume(messages)).messages;
  const safety = createSafety({
    call: {
      constraints: args.constraints,
      guardrails: args.guardrails,
      constraintMaxRetries: args.constraintMaxRetries,
    },
    safety: args.safety,
    resolved: {
      constraints: resolved.constraints,
      guardrails: resolved.guardrails,
      metadata: resolved.metadata,
    },
    promptId: prompt.id,
    model: modelInfo.modelId,
    systemPrompt: resolved.system,
  });
  messages = [...(await safety.guardInput({ messages })).messages];

  let schemaParams: Record<string, unknown> | undefined;
  if (resolved.schema && dialect.wrapOutputSchema) {
    schemaParams = dialect.wrapOutputSchema(resolved.schema);
  }
  const providerMessages = await normalizeInvocationMessages(messages, {
    provider: modelInfo.provider,
  });

  const callArgs: CallArgs<TExtra> = {
    model: modelInfo.modelId,
    system: resolved.system,
    systemBlocks: resolved.systemBlocks,
    messages: providerMessages,
    settings: mappedSettings,
    schema: resolved.schema,
    schemaParams,
    tools,
    extra: (args.extra ?? {}) as TExtra,
  };

  const handle = await orchestrateStream(
    {
      promptId: prompt.id,
      promptConfig: prompt.config ?? ({} as typeof prompt.config),
      preparedArgs: { ...callArgs, input: args.input ?? {} },
      input: args.input ?? {},
      provider: modelInfo.provider,
      model: modelInfo.modelId,
      resolved,
      outputMode: resolved.schema ? "object" : "text",
      timeout: args.timeout,
      createCachedStreamResult: (cached) =>
        createCachedStreamHandle(cached) as unknown as MiddlewareResult,
    },
    async () => {
      emitInputTokenEstimate({
        messages: providerMessages,
        provider: modelInfo.provider,
        model: modelInfo.modelId,
        media: dialect.media,
        tokenBudget: args.tokenBudget,
      });
      return withBudget(
        (signal) =>
          dialect.stream(dialect.client, callArgs, {
            signal: composeAbortSignals(args.signal, signal),
          }),
        {
          budget: "step",
          limitMs: args.timeout?.stepMs,
        },
      );
    },
  );

  const safetyStream = safety.enabled ? safety.openStream() : undefined;
  let streamedAssistantText = "";

  /** Yield provider chunks while replacing held/transformed safety text deltas. */
  async function* trackedRawStream() {
    type Chunk = Awaited<TRawStream extends AsyncIterable<infer T> ? T : never>;
    for await (const chunk of handle.rawStream as AsyncIterable<unknown>) {
      const delta = handle.extractTextDelta(chunk);
      if (!safetyStream || delta === undefined || delta === "") {
        if (delta) streamedAssistantText += delta;
        yield chunk as Chunk;
        continue;
      }
      const directive = await safetyStream.feed(delta);
      if (directive.kind === "hold") continue;
      streamedAssistantText += directive.content;
      if (directive.content === delta) {
        yield chunk as Chunk;
      } else if (directive.content.length > 0) {
        yield createSafetyTextChunk(directive.content) as Chunk;
      }
    }
    if (safetyStream) {
      const seal = await safetyStream.finish();
      if (seal.pending.length > 0) {
        streamedAssistantText += seal.pending;
        yield createSafetyTextChunk(seal.pending) as Chunk;
      }
    }
  }

  return {
    ...handle,
    rawStream: trackedRawStream() as unknown as TRawStream &
      AsyncIterable<unknown>,
    extractTextDelta: (chunk: unknown) =>
      isSafetyTextChunk(chunk) ? chunk.text : handle.extractTextDelta(chunk),
    completion: async () => {
      const meta = await handle.completion();
      const providerContent = responseContent({
        content: meta?.content,
        text: meta?.text ?? "",
        toolCalls: meta?.toolCalls?.flatMap((call) =>
          typeof call.id === "string"
            ? [{ id: call.id, name: call.name, args: call.args }]
            : [],
        ),
      });
      const providerTextSlots = providerContent.flatMap((part) =>
        part.type === "text" ? [part.text] : [],
      );
      const hasMixedProviderText =
        providerTextSlots.length > 1 ||
        (providerTextSlots.length > 0 &&
          providerContent.some((part) => part.type !== "text"));
      const guardedSlots =
        safety.enabled && hasMixedProviderText
          ? await safety.guardOutputTextParts(providerTextSlots)
          : undefined;
      const text = guardedSlots
        ? guardedSlots.join("")
        : safety.enabled
          ? streamedAssistantText
          : (meta?.text ?? streamedAssistantText);
      const content = guardedSlots
        ? replaceTextSlots(providerContent, guardedSlots)
        : safety.enabled
          ? replaceTextSlots(
              providerContent,
              providerTextSlots.length === 0 ? [] : [text],
              text,
            )
          : providerContent;
      const stamped = meta ? safety.stamp(meta) : meta;
      const assistantMessage: Message = {
        role: "assistant",
        content,
        ...(meta?.toolCalls ? { metadata: { toolCalls: meta.toolCalls } } : {}),
      };
      const completionMessages = meta?.messages
        ? replaceFinalAssistant(meta.messages, assistantMessage)
        : [...messages, assistantMessage];
      await lifecycle.captureTurn({
        messages,
        assistantText: streamedAssistantText || undefined,
        toolCalls: meta?.toolCalls,
      });
      return {
        ...stamped,
        text,
        content,
        messages: completionMessages,
      };
    },
  };
}

/** Stamp authoritative assistant output into a provider-completed transcript. */
function replaceFinalAssistant(
  messages: readonly Message[],
  assistant: Message,
): readonly Message[] {
  const result = [...messages];
  for (let index = result.length - 1; index >= 0; index -= 1) {
    if (result[index]?.role === "assistant") {
      result[index] = assistant;
      return result;
    }
  }
  result.push(assistant);
  return result;
}
