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
import { createSafetyWithBindingApplicability } from "../../safety/session";
import { languageBindingApplicability } from "../../safety/language-applicability";
import type { LiveTextSlot } from "../../safety/output/completion";
import { orchestrateStream } from "../../generation/orchestrate";
import { composeAbortSignals, withBudget } from "../../generation/timeout";
import { normalizeAdapterCallError } from "../normalized-outcome";
import { normalizeInvocationMessages } from "../../content/invocation-message";
import { assertProviderMediaSupported } from "../native-chat/media-hooks";
import type { CallArgs, StreamHandle } from "../types";
import { createToolLifecycle } from "../tool/session";
import type { AdapterExecutionStreamArgs, CoreStepDialect } from "./types";
import { initialCoreMessages } from "./messages";
import { createCachedStreamHandle } from "./metadata";
import { buildResolveOpts } from "./shared";
import { isSafetyTextChunk } from "./stream-safety";
import { emitInputTokenEstimate } from "./media-token-budget";
import {
  guardStreamCompletion,
  trackSafetyStreamSeal,
} from "./stream-completion";
import type { WithOperationResultMeta } from "../../observability";
import { materializeToolSources } from "./tool-sources";
import { createStreamSourceCleanup } from "./stream-source-cleanup";
import { trackRawStream } from "./stream-tracking";
import type { CruxRunId } from "../../observability";

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
): Promise<
  WithOperationResultMeta<StreamHandle<TRawStream>> &
    Readonly<{ runId: CruxRunId }>
> {
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
  let resolved = await prompt.resolve(resolveOpts);
  const mappedSettings = dialect.mapSettings(resolved.settings);
  let messages = initialCoreMessages(resolved, args.messages);
  let currentSystem = resolved.system;
  let currentSystemBlocks = resolved.systemBlocks;
  const safety = createSafetyWithBindingApplicability(
    {
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
    },
    languageBindingApplicability(resolved.schema !== undefined),
  );
  const guardedInput = await safety.guardInput({
    messages,
    system: currentSystem,
  });
  messages = [...guardedInput.messages];
  if (guardedInput.system !== currentSystem) currentSystemBlocks = undefined;
  currentSystem = guardedInput.system;
  const sourceSession = await materializeToolSources({
    dialect: dialect.id,
    resolved,
    materialize: dialect.materializeToolSource,
    runtimeContext: args.runtimeContext,
    abortSignal: args.signal,
  });
  resolved = sourceSession.resolved;

  try {
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
    const tools = lifecycle.descriptors
      ? [...lifecycle.descriptors]
      : undefined;
    messages = (await lifecycle.resume(messages)).messages;

    let schemaParams: Record<string, unknown> | undefined;
    if (resolved.schema && dialect.wrapOutputSchema) {
      schemaParams = dialect.wrapOutputSchema(resolved.schema);
    }
    const providerMessages = await normalizeInvocationMessages(messages, {
      provider: modelInfo.provider,
    });
    assertProviderMediaSupported(
      { providerId: dialect.id, media: dialect.media },
      {
        provider: modelInfo.provider,
        model: modelInfo.modelId,
        messages: providerMessages,
      },
    );

    const callArgs: CallArgs<TExtra> = {
      model: modelInfo.modelId,
      system: currentSystem,
      systemBlocks: currentSystemBlocks,
      messages: providerMessages,
      settings: mappedSettings,
      schema: resolved.schema,
      schemaParams,
      tools,
      extra: (args.extra ?? {}) as TExtra,
    };

    let providerRawStream: TRawStream | undefined;
    const handle = await sourceSession.withContext(() =>
      orchestrateStream(
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
          const providerHandle = await withBudget(
            (signal) =>
              dialect.stream(dialect.client, callArgs, {
                signal: composeAbortSignals(args.signal, signal),
              }),
            {
              budget: "step",
              limitMs: args.timeout?.stepMs,
            },
          ).catch((error: unknown) => {
            throw normalizeAdapterCallError(error, {
              providerId: modelInfo.provider,
              signal: args.signal,
              mapError: dialect.mapError,
            });
          });
          providerRawStream = providerHandle.raw ?? providerHandle.rawStream;
          return providerHandle;
        },
      ),
    );

    const trackedSafety = safety.enabled
      ? trackSafetyStreamSeal(safety.openStream())
      : undefined;
    const streamedAssistant: {
      text: string;
      providerText: string;
      exactSlots: boolean;
      slots: LiveTextSlot[];
    } = { text: "", providerText: "", exactSlots: true, slots: [] };
    const closeSources = createStreamSourceCleanup(sourceSession, args.signal);

    return {
      ...handle,
      raw: handle.raw ?? providerRawStream ?? handle.rawStream,
      rawStream: trackRawStream<TRawStream>({
        rawStream: handle.rawStream as AsyncIterable<unknown>,
        extractTextDelta: handle.extractTextDelta,
        safetyStream: trackedSafety?.stream,
        observeText: (text) => {
          streamedAssistant.providerText += text;
        },
        appendText: (text) => {
          streamedAssistant.text += text;
        },
        recordText: (providerText, guardedText, directive) => {
          if (directive === "hold") streamedAssistant.exactSlots = false;
          streamedAssistant.slots.push({ providerText, guardedText });
        },
        close: closeSources,
      }),
      extractTextDelta: (chunk: unknown) =>
        isSafetyTextChunk(chunk) ? chunk.text : handle.extractTextDelta(chunk),
      completion: async () => {
        try {
          const meta = await handle.completion();
          const liveText =
            trackedSafety?.sealedText() ??
            (streamedAssistant.providerText
              ? streamedAssistant.text
              : undefined);
          const liveTextSlots =
            trackedSafety &&
            streamedAssistant.exactSlots &&
            streamedAssistant.slots
              .map((slot) => slot.providerText)
              .join("") === streamedAssistant.providerText &&
            streamedAssistant.slots.map((slot) => slot.guardedText).join("") ===
              liveText
              ? streamedAssistant.slots
              : undefined;
          const guarded = await guardStreamCompletion({
            safety,
            meta,
            assembleWithoutSafety: true,
            liveText,
            representedText: streamedAssistant.providerText || undefined,
            liveTextSlots,
            messages,
          });
          await lifecycle.captureTurn({
            messages,
            assistantText: guarded?.text || undefined,
            toolCalls: meta?.toolCalls,
          });
          return guarded;
        } finally {
          await closeSources();
        }
      },
    };
  } catch (error) {
    await sourceSession.close();
    throw error;
  }
}
