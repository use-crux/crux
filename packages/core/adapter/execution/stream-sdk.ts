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
): Promise<ExecutorStreamHandle<TRawStream>> {
  const prompt = args.prompt;
  const modelInfo = dialect.describeModel(args.model);
  const resolveOpts = buildResolveOpts({
    input: args.input,
    provider: modelInfo.provider,
    modelId: modelInfo.modelId,
    tokenBudget: args.tokenBudget,
    settings: args.settings,
  });
  const resolved = await prompt.resolve(resolveOpts);
  const diagnostics = withDefaultResolverPorts().diagnostics;
  const mappedSettings = dialect.mapSettings(resolved.settings, modelInfo);
  const lifecycle = createToolLifecycle({
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
  const tools = lifecycle.tools;
  let { messages, promptText } = initialMessageState(resolved, args.messages);
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
  const guardedInput = await safety.guardInput({
    messages,
    prompt: promptText,
  });
  messages = [...guardedInput.messages];
  promptText = guardedInput.prompt;

  const stepBudget = createBudgetSignal({
    budget: "step",
    limitMs: args.timeout?.stepMs,
  });
  const request: ExecutorRequest<TModel> & { schema?: z.ZodType } = {
    model: args.model,
    modelInfo,
    system: resolved.system,
    systemBlocks: resolved.systemBlocks,
    prompt: promptText,
    messages,
    settings: mappedSettings,
    unsupportedContent: resolved.settings.unsupportedContent,
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
    ...(safety.enabled && !resolved.schema
      ? { safety: safety.openStream() }
      : {}),
    ...(resolved.schema ? { schema: resolved.schema } : {}),
  };

  let handle: ExecutorStreamHandle<TRawStream>;
  try {
    handle = await orchestrateStream<
      Record<string, unknown>,
      ExecutorStreamHandle<TRawStream>
    >(
      {
        promptId: prompt.id,
        promptConfig:
          prompt.config ?? ({} as NonNullable<typeof prompt.config>),
        preparedArgs: {
          model: modelInfo.modelId,
          system: resolved.system,
          systemBlocks: resolved.systemBlocks,
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
      async () => dialect.runStream(request),
    );
  } catch (error) {
    stepBudget.dispose();
    throw error;
  }

  const innerCompletion = handle.completion.bind(handle);
  const wrappedCompletion = async (): Promise<
    ExecutorStreamMeta | undefined
  > => {
    try {
      const meta = await innerCompletion();
      const stamped = meta ? safety.stamp(meta) : meta;
      await lifecycle.captureTurn({
        messages,
        assistantText: stamped?.text,
        toolCalls: stamped?.toolCalls,
      });
      return stamped;
    } finally {
      stepBudget.dispose();
    }
  };

  return { ...handle, completion: wrappedCompletion };
}
