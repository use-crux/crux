/**
 * SDK-loop non-streaming execution.
 *
 * This module wraps loop-owning SDKs such as the Vercel AI SDK. The SDK drives
 * the step loop, while Crux prepares the request, merges tools, steers skill
 * loads through `StepObserver`, applies safety/retry policy, and captures the
 * completed turn.
 *
 * @internal
 * @module
 */

import type { Message } from "../../generation/messages";
import { createSafety } from "../../safety/session";
import type { Safety } from "../../safety/session";
import { orchestrateGenerate } from "../../generation/orchestrate";
import { createBudgetSignal, type BudgetSignal } from "../../generation/timeout";
import type {
  ExecutorOutcome,
  ExecutorRequest,
  StepDirective,
  StepObserver,
} from "../executor-types";
import {
  describeTools,
  interceptGeneration,
  type InterceptedGeneration,
} from "../interception";
import { createToolLifecycle } from "../tool/session";
import type {
  AdapterExecutionGenerateArgs,
  AdapterExecutionGenerateResult,
  SdkLoopDialect,
} from "./types";
import type { ResultStepFacts } from "../result-accumulator";
import { initialMessageState } from "./messages";
import { buildTraceMeta } from "./metadata";
import {
  finalizeSdkResultEnvelope,
  sdkResponseFacts,
  sdkStepFacts,
} from "./sdk-result-envelope";
import {
  buildResolveOpts,
  DEFAULT_MAX_STEPS,
  inspectForDevtools,
  mergeDirectives,
  withSkillActivationInput,
} from "./shared";
import { generateSdkStructured } from "./generate-sdk-structured";

/** Regeneration is deliberately unavailable after tool-approval suspension. */
const unreachableRegenerate = (): Promise<never> => {
  throw new Error("regenerate is unreachable for suspended results");
};

/**
 * Execute one prompt through an SDK-owned loop.
 *
 * Routing has already selected a concrete model before this function runs.
 * The SDK receives a fully prepared `ExecutorRequest`; Crux owns everything
 * around that request, including timeout signals, tool approval resume,
 * safety, validation retry, trace metadata, and memory capture.
 *
 * @param dialect - Normalized SDK-loop dialect for one bound SDK client.
 * @param args - Prepared execution arguments from `loopRuntimeAdapter()`.
 * @returns The normalized non-streaming executor result.
 */
export async function generateSdk<TModel, TRawResponse, TRawStream>(
  dialect: SdkLoopDialect<TModel, TRawResponse, TRawStream>,
  args: AdapterExecutionGenerateArgs<TModel, Record<string, unknown>>,
): Promise<AdapterExecutionGenerateResult<TRawResponse>> {
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

  let { messages, promptText } = initialMessageState(resolved, args.messages);
  messages = (await lifecycle.resume(messages)).messages;
  let currentSystem = resolved.system;
  let currentSystemBlocks = resolved.systemBlocks;
  const maxSteps =
    args.maxSteps ?? resolved.settings.maxSteps ?? DEFAULT_MAX_STEPS;
  const retryId = args.validationRetry
    ? `vr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    : "";
  const safety: Safety = createSafety({
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
    traceId: retryId || undefined,
    systemPrompt: resolved.system,
  });

  let stepBudget: BudgetSignal = createBudgetSignal(undefined);
  const stepFacts: ResultStepFacts[] = [];
  const loopObserver: StepObserver = {
    onStepEnd: async (step) => {
      stepBudget.refresh();
      stepFacts.push(sdkStepFacts(step));
      const amendment = await lifecycle.applySkillLoads(step.toolCalls);
      let factoryDirective: StepDirective = { kind: "continue" };
      if (amendment) {
        currentSystem = amendment.system;
        currentSystemBlocks = amendment.systemBlocks;
        factoryDirective = {
          kind: "amend",
          ...(amendment.system !== undefined
            ? { system: amendment.system }
            : {}),
          ...(amendment.systemBlocks !== undefined
            ? { systemBlocks: amendment.systemBlocks }
            : {}),
          ...(lifecycle.tools !== undefined ? { tools: lifecycle.tools } : {}),
          refundStep: true,
        };
      }
      const callerDirective = await args.observer?.onStepEnd(step);
      return mergeDirectives(factoryDirective, callerDirective);
    },
  };

  const buildRequest = (
    signal: AbortSignal | undefined,
  ): ExecutorRequest<TModel> => ({
    model: args.model,
    modelInfo,
    system: currentSystem,
    systemBlocks: currentSystemBlocks,
    prompt: promptText,
    messages,
    settings: mappedSettings,
    unsupportedContent: resolved.settings.unsupportedContent,
    tools: lifecycle.tools,
    toolApproval: (call) =>
      lifecycle.requiresApproval(
        { id: call.toolCallId, name: call.toolName, args: call.input },
        call.messages ?? messages,
      ),
    activeTools: args.activeTools,
    maxSteps,
    observer: loopObserver,
    abortSignal: signal,
    extra: args.extra,
  });

  const generated = await orchestrateGenerate<
    Record<string, unknown>,
    AdapterExecutionGenerateResult<TRawResponse>
  >(
    {
      promptId: prompt.id,
      promptConfig: prompt.config ?? ({} as NonNullable<typeof prompt.config>),
      preparedArgs: {
        model: modelInfo.modelId,
        system: currentSystem,
        systemBlocks: currentSystemBlocks,
        prompt: promptText,
        messages,
        settings: mappedSettings,
        schema: resolved.schema,
        tools: lifecycle.tools,
        input: args.input ?? {},
        ...(await inspectForDevtools(prompt, resolveOpts, lifecycle.tools)),
      },
      model: args.model,
      input: args.input ?? {},
      provider: modelInfo.provider || dialect.id,
      resolved,
      outputMode: resolved.schema ? "object" : "text",
      timeout: args.timeout,
    },
    async () => {
      try {
        const guardedInput = await safety.guardInput({
          messages,
          prompt: promptText,
        });
        messages = [...guardedInput.messages];
        promptText = guardedInput.prompt;
        stepBudget = createBudgetSignal({
          budget: "step",
          limitMs: args.timeout?.stepMs,
        });
        const request = buildRequest(stepBudget.signal);
        const result = resolved.schema
          ? await generateSdkStructured({
              dialect,
              args,
              request,
              schema: resolved.schema,
              safety,
              retryId,
              promptId: prompt.id,
              describeCall,
              stepFacts,
            })
          : await generateLoop(request);
        result._meta = safety.stamp(result._meta);
        return result;
      } finally {
        stepBudget.dispose();
      }
    },
  );

  await lifecycle.captureTurn({
    messages: generated.messages,
    assistantText: generated.text,
    toolCalls: generated._meta.toolCalls,
  });

  return generated;

  /** Describe a concrete SDK call for interception, middleware, and devtools. */
  function describeCall(
    kind: "loop" | "structured",
    request: ExecutorRequest<TModel>,
  ): InterceptedGeneration {
    return {
      kind,
      promptId: prompt.id,
      modelInfo,
      system: request.system,
      prompt: request.prompt,
      messages: request.messages,
      settings: request.settings,
      tools: describeTools(request.tools),
    };
  }

  /** Run the SDK text/tool loop and apply final-output safety regeneration. */
  async function generateLoop(
    request: ExecutorRequest<TModel>,
  ): Promise<AdapterExecutionGenerateResult<TRawResponse>> {
    const outcome = await interceptGeneration(
      describeCall("loop", request),
      () => dialect.runTextLoop(request),
    );

    if (outcome.status === "suspended") {
      const result = buildSuspendedResult(outcome);
      await safety.finalizeOutput(
        { text: result.text },
        unreachableRegenerate,
        {
          suspended: true,
          messages: result.messages,
        },
      );
      return result;
    }

    let finalText = outcome.response.text;
    let finalRaw = outcome.raw;
    let finalResponse = outcome.response;
    let finalCostUsd = outcome.meta.costUsd;
    const resultStepFacts = [...(outcome.stepFacts ?? stepFacts)];
    let resultMessages = [...outcome.messages];
    const finalOutput = await safety.finalizeOutput(
      { text: finalText, parsed: undefined },
      async (corrective) => {
        const regenMessages: Message[] = [...resultMessages, ...corrective];
        const regenRequest: ExecutorRequest<TModel> = {
          ...request,
          prompt: undefined,
          messages: regenMessages,
          maxSteps: 1,
          observer: undefined,
        };
        const regen = await interceptGeneration(
          describeCall("loop", regenRequest),
          () => dialect.runTextLoop(regenRequest),
        );
        if (regen.status === "complete") {
          if (resultStepFacts.length > 0) {
            const previous = resultStepFacts[resultStepFacts.length - 1]!;
            resultStepFacts[resultStepFacts.length - 1] = {
              ...previous,
              text: "",
            };
          }
          finalText = regen.response.text;
          finalRaw = regen.raw;
          finalResponse = regen.response;
          finalCostUsd = regen.meta.costUsd;
          resultMessages = [...regen.messages];
          resultStepFacts.push(sdkResponseFacts(regen.response));
          return { text: regen.response.text, parsed: undefined };
        }
        return { text: finalText, parsed: undefined };
      },
      { messages: resultMessages },
    );
    if (finalOutput.text !== finalText) {
      finalText = finalOutput.text;
      if (resultStepFacts.length > 0) {
        const previous = resultStepFacts[resultStepFacts.length - 1]!;
        resultStepFacts[resultStepFacts.length - 1] = {
          ...previous,
          text: finalText,
        };
      }
    }

    return finalizeSdkResultEnvelope({
      raw: finalRaw,
      response: finalResponse,
      text: finalText,
      _meta: buildTraceMeta({
        response: { ...finalResponse, text: finalText },
        costUsd: finalCostUsd,
      }),
      messages: resultMessages,
      stepFacts: resultStepFacts,
      finalStepMode: "preserve",
    });
  }

  /** Convert an SDK approval suspension into the shared adapter result shape. */
  function buildSuspendedResult(
    outcome: Extract<ExecutorOutcome<TRawResponse>, { status: "suspended" }>,
  ): AdapterExecutionGenerateResult<TRawResponse> {
    const sealed = lifecycle.suspend(
      outcome.pendingApprovals,
      outcome.assistantResponse,
      outcome.messages,
    );
    return finalizeSdkResultEnvelope<TRawResponse>({
      raw: undefined,
      response: {
        ...outcome.assistantResponse,
        finishReason: "tool_approval_required",
      },
      text: outcome.assistantResponse.text,
      _meta: buildTraceMeta({
        response: {
          ...outcome.assistantResponse,
          finishReason: "tool_approval_required",
        },
      }),
      messages: sealed.messages,
      pendingApprovals: sealed.requests,
      stepFacts,
    });
  }
}
