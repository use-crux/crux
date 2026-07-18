/**
 * SDK-loop streaming execution.
 *
 * This module prepares streaming requests for loop-owning SDKs, wires timeout
 * cleanup and semantic-cache replay, and wraps completion so safety metadata
 * and memory capture stay centralized.
 *
 * @internal
 * @module
 */

import type { z } from "zod";
import type { MiddlewareResult } from "../../runtime/types";
import { createSafety } from "../../safety/session";
import { orchestrateStream } from "../../generation/orchestrate";
import {
  composeAbortSignals,
  createBudgetSignal,
} from "../../generation/timeout";
import { normalizeInvocationMessages } from "../../content/invocation-message";
import { assertProviderMediaSupported } from "../native-chat/media-hooks";
import { withDefaultResolverPorts } from "../../resolver/ports";
import type {
  ExecutorRequest,
  ExecutorStreamHandle,
  ExecutorStreamMeta,
} from "../executor-types";
import { createToolLifecycle } from "../tool/session";
import type { AdapterExecutionStreamArgs, SdkLoopDialect } from "./types";
import { initialMessageState } from "./messages";
import {
  buildResolveOpts,
  DEFAULT_MAX_STEPS,
  inspectForDevtools,
  withSkillActivationInput,
} from "./shared";
import { emitInputTokenEstimate } from "./media-token-budget";
import { materializeToolSources } from "./tool-sources";
import { createStreamSourceCleanup } from "./stream-source-cleanup";
import type { CruxRunId } from "../../observability";
import {
  guardStreamCompletion,
  trackSafetyStreamSeal,
} from "./stream-completion";

/**
 * Start one SDK-owned stream for a concrete model attempt.
 *
 * The SDK keeps ownership of the raw stream handle. Crux prepares the request,
 * applies input safety first, passes stream-safety state when supported, and
 * stamps/captures completion metadata when the SDK reports final usage.
 *
 * @param dialect - Normalized SDK-loop dialect for one bound SDK client.
 * @param args - Prepared streaming arguments from `loopRuntimeAdapter()`.
 * @returns The SDK's executor stream handle with wrapped completion.
 */
export async function streamSdk<TModel, TRawResponse, TRawStream>(
  dialect: SdkLoopDialect<TModel, TRawResponse, TRawStream>,
  args: AdapterExecutionStreamArgs<TModel, Record<string, unknown>>,
): Promise<ExecutorStreamHandle<TRawStream> & { readonly runId: CruxRunId }> {
  const prompt = args.prompt;
  const modelInfo = dialect.describeModel(args.model);
  const resolveOpts = buildResolveOpts({
    input: args.input,
    provider: modelInfo.provider,
    modelId: modelInfo.modelId,
    tokenBudget: args.tokenBudget,
    settings: args.settings,
  });
  let resolved = await prompt.resolve(resolveOpts);
  const diagnostics = withDefaultResolverPorts().diagnostics;
  const mappedSettings = dialect.mapSettings(resolved.settings, modelInfo);
  let { messages, promptText } = initialMessageState(resolved, args.messages);
  let nativeMessages = args.nativeMessages;
  let currentSystem = resolved.system;
  let currentSystemBlocks = resolved.systemBlocks;
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
  const guardedInput = await safety.guardInput({
    messages,
    prompt: promptText,
    system: currentSystem,
  });
  if (
    guardedInput.messages !== messages ||
    guardedInput.system !== currentSystem
  )
    nativeMessages = undefined;
  messages = [...guardedInput.messages];
  promptText = guardedInput.prompt;
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
  const closeSources = createStreamSourceCleanup(sourceSession, args.signal);
  let lifecycle: ReturnType<typeof createToolLifecycle>;
  try {
    lifecycle = createToolLifecycle({
      regime: "sdk",
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
      reresolve: (skillSession) =>
        prompt.resolve(withSkillActivationInput(resolveOpts, skillSession)),
    });
    const resumed = await lifecycle.resume(messages);
    messages = resumed.messages;
    if (resumed.replayed > 0) nativeMessages = undefined;
  } catch (error) {
    await closeSources();
    throw error;
  }
  const tools = lifecycle.tools;
  const trackedSafety =
    safety.enabled && !resolved.schema
      ? trackSafetyStreamSeal(safety.openStream())
      : undefined;

  const stepBudget = createBudgetSignal({
    budget: "step",
    limitMs: args.timeout?.stepMs,
  });
  let providerMessages:
    | Awaited<ReturnType<typeof normalizeInvocationMessages>>
    | undefined;
  try {
    providerMessages =
      messages.length > 0
        ? await normalizeInvocationMessages(messages, {
            provider: modelInfo.provider,
          })
        : undefined;
    assertProviderMediaSupported(
      { providerId: dialect.id, media: dialect.media },
      {
        provider: modelInfo.provider,
        model: modelInfo.modelId,
        messages: providerMessages ?? [],
      },
    );
  } catch (error) {
    stepBudget.dispose();
    await closeSources();
    throw error;
  }
  const request: ExecutorRequest<TModel> & { schema?: z.ZodType } = {
    model: args.model,
    modelInfo,
    system: currentSystem,
    systemBlocks: currentSystemBlocks,
    prompt: promptText,
    messages: providerMessages,
    nativeMessages,
    settings: mappedSettings,
    tools,
    toolApproval: (call) =>
      lifecycle.requiresApproval(
        { id: call.toolCallId, name: call.toolName, args: call.input },
        call.messages ?? messages,
      ),
    activeTools: args.activeTools,
    maxSteps: args.maxSteps ?? resolved.settings.maxSteps ?? DEFAULT_MAX_STEPS,
    observer: args.observer,
    abortSignal: composeAbortSignals(args.signal, stepBudget.signal),
    extra: args.extra,
    diagnostics,
    ...(trackedSafety ? { safety: trackedSafety.stream } : {}),
    ...(resolved.schema ? { schema: resolved.schema } : {}),
  };

  let handle: ExecutorStreamHandle<TRawStream> & {
    readonly runId: CruxRunId;
  };
  try {
    handle = await sourceSession.withContext(async () =>
      orchestrateStream<
        Record<string, unknown>,
        ExecutorStreamHandle<TRawStream>
      >(
        {
          promptId: prompt.id,
          promptConfig:
            prompt.config ?? ({} as NonNullable<typeof prompt.config>),
          preparedArgs: {
            model: modelInfo.modelId,
            system: currentSystem,
            systemBlocks: currentSystemBlocks,
            prompt: promptText,
            messages,
            settings: mappedSettings,
            schema: resolved.schema,
            tools,
            input: args.input ?? {},
            ...(await inspectForDevtools(prompt, resolveOpts, tools)),
          },
          input: args.input ?? {},
          provider: modelInfo.provider || dialect.id,
          model: args.model,
          traceModel: modelInfo.modelId || undefined,
          resolved,
          outputMode: resolved.schema ? "object" : "text",
          timeout: args.timeout,
          ...(dialect.replayStream
            ? {
                createCachedStreamResult: (cached: {
                  text?: string;
                  object?: unknown;
                  meta?: Record<string, unknown>;
                }) =>
                  dialect.replayStream!(cached) as unknown as MiddlewareResult,
              }
            : {}),
        },
        async () => {
          emitInputTokenEstimate({
            messages: providerMessages ?? [],
            provider: modelInfo.provider,
            model: modelInfo.modelId,
            media: dialect.media,
            tokenBudget: args.tokenBudget,
          });
          return dialect.runStream(request);
        },
      ),
    );
  } catch (error) {
    stepBudget.dispose();
    await closeSources();
    throw error;
  }

  const innerCompletion = handle.completion.bind(handle);
  const wrappedCompletion = async (): Promise<
    ExecutorStreamMeta | undefined
  > => {
    try {
      const meta = await innerCompletion();
      const guarded = await guardStreamCompletion({
        safety,
        meta,
        liveText: trackedSafety
          ? (trackedSafety.sealedText() ?? meta?.text)
          : undefined,
        representedText: trackedSafety ? meta?.text : undefined,
        messages,
      });
      await lifecycle.captureTurn({
        messages,
        assistantText: guarded?.text,
        toolCalls: guarded?.toolCalls,
      });
      return guarded;
    } finally {
      stepBudget.dispose();
      await closeSources();
    }
  };

  return { ...handle, completion: wrappedCompletion };
}
