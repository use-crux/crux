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
import {
  createSafetyWithBindingApplicability,
  createSafetyLanguageStepTransformer,
  finalizeSafetySessionLanguageOutput,
  guardSafetySessionResolvedInput,
  safetySessionFeedbackGuard,
  safetySessionMemoryWriteGuard,
  safetySessionModelIngressGuard,
  safetySessionToolDefinitionGuard,
  safetySessionToolDescriptionGuard,
  safetyRequiresLanguageStepTransform,
} from "../../safety/session";
import { languageBindingApplicability } from "../../safety/language-applicability";
import type { Safety } from "../../safety/session";
import { SafetyConfigError } from "../../safety/errors";
import { orchestrateGenerateWithCompletion } from "../../generation/orchestrate";
import {
  composeAbortSignals,
  createBudgetSignal,
  type BudgetSignal,
} from "../../generation/timeout";
import { normalizeInvocationMessages } from "../../content/invocation-message";
import { assertProviderMediaSupported } from "../native-chat/media-hooks";
import type {
  ExecutorOutcome,
  ExecutorRequest,
  StepDirective,
  StepObserver,
} from "../executor-types";
import { createToolLifecycle } from "../tool/session";
import type {
  AdapterExecutionGenerateArgs,
  AdapterExecutionGenerateResult,
  AdapterExecutionGenerateResultWithoutRunId,
  ObservedAdapterExecutionGenerateResult,
  SdkLoopDialect,
} from "./types";
import type { ResultStepFacts } from "../result-accumulator";
import { initialMessageState } from "./messages";
import { sdkHistorySummaryGenerator } from "./history-summary";
import { buildTraceMeta } from "./metadata";
import {
  finalizeSdkResultEnvelope,
  sdkResponseFacts,
  sdkStepFacts,
} from "./sdk-result-envelope";
import {
  buildResolveOpts,
  DEFAULT_MAX_STEPS,
  previewForDevtools,
  mergeDirectives,
  resolveToolInputCapabilities,
  withSkillActivationInput,
} from "./shared";
import { generateSdkStructured } from "./generate-sdk-structured";
import { emitInputTokenEstimate } from "./media-token-budget";
import { materializeToolSources } from "./tool-sources";
import { toolModelIngressDialect } from "../tool/model-ingress-port";
import { createSkillIngressAmendmentGuard } from "./skill-ingress-amendment";
import { systemMessagePrefixPatch } from "./system-prefix-patch";
import { guardCorrectiveWriteback } from "../../safety/session-feedback-guard";
import { replaceFinalAssistantOutput } from "./messages";
import {
  compileStructuredOutputForRequest,
  CruxUnsupportedStructuredOutputError,
  type StructuredOutputPlan,
} from "../structured-output";
import { withDefaultResolverPorts } from "../../resolver/ports";
import { createCachedGenerateCandidateFinalizer } from "./cached-generate-candidate";
import { attachCachedCandidateFinalizer } from "../../runtime/internal/cached-candidate-finalizer";
import {
  assertSdkRequestPlanning,
  createSdkRequestStepPlanner,
} from "./sdk-request-planner";
import {
  guardRepresentedRequest,
  selectRepresentationCapabilities,
  selectRepresentationMiddleware,
  selectRepresentationSkills,
} from "./representation-safety";
import { OFFLOAD_SUPPORT_TOOL_NAME } from "../../request/offload/support-tool";
import {
  alignThreadInvocationInput,
  prepareThreadInvocation,
} from "./thread-history";
import { attachThreadCommit } from "./thread-result";
import { managedGenerationStepBoundary } from "../../generation-model/execution-checkpoint";
import { checkpointAndCommitManagedGeneration } from "./managed-generation-checkpoint";

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
): Promise<ObservedAdapterExecutionGenerateResult<TRawResponse>> {
  const prompt = args.prompt;
  const modelInfo = dialect.describeModel(args.model);
  assertSdkRequestPlanning(dialect);
  const resolveOpts = buildResolveOpts({
    input: args.input,
    provider: modelInfo.provider,
    modelId: modelInfo.modelId,
    settings: args.settings,
  });
  let boundaryResolveOpts = resolveOpts;
  let resolved = await prompt.resolve(resolveOpts);
  let threadInvocation = await prepareThreadInvocation(
    resolved,
    args.messages ?? (args.nativeMessages !== undefined ? [] : undefined),
  );
  const mappedSettings = dialect.mapSettings(resolved.settings, modelInfo);
  const initialMessages = initialMessageState(
    resolved,
    args.messages,
    args.nativeMessages,
    threadInvocation.source,
  );
  let { messages, promptText } = initialMessages;
  let nativeMessages =
    threadInvocation.source || initialMessages.history?.changed
      ? undefined
      : args.nativeMessages;
  let currentSystem = resolved.system;
  let currentSystemBlocks = resolved.systemBlocks;
  const retryId = args.validationRetry
    ? `vr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    : "";
  const safety: Safety = createSafetyWithBindingApplicability(
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
      traceId: retryId || undefined,
      systemPrompt: resolved.system,
    },
    languageBindingApplicability(resolved.schema !== undefined),
  );
  if (
    safetyRequiresLanguageStepTransform(safety) &&
    dialect.capabilities?.stepTransform !== "before-client-tools"
  ) {
    throw new SafetyConfigError({
      message: `Loop runtime "${dialect.id}" must support step transform before client tools for the applicable language output guardrails.`,
    });
  }
  const stepTransformer = createSafetyLanguageStepTransformer(
    safety,
    resolved.schema,
  );
  selectRepresentationCapabilities(safety, resolved.representations ?? []);
  selectRepresentationSkills(resolved, resolved.representations ?? []);
  const guardedInput = await guardSafetySessionResolvedInput(
    safety,
    resolved,
    {
      messages,
      prompt: promptText,
      system: currentSystem,
    },
    {
      resolvedMessages:
        initialMessages.source === "resolved-messages"
          ? "selected"
          : "discarded",
    },
  );
  if (
    guardedInput.messages !== messages ||
    guardedInput.system !== currentSystem
  )
    nativeMessages = undefined;
  messages = [...guardedInput.messages];
  promptText = guardedInput.prompt;
  threadInvocation = alignThreadInvocationInput(
    threadInvocation,
    {
      messages,
      ...(promptText ? { prompt: promptText } : {}),
    },
    initialMessages.historyMessageCount,
  );
  if (guardedInput.system !== currentSystem) currentSystemBlocks = undefined;
  currentSystem = guardedInput.system;
  const guardSkillAmendment = createSkillIngressAmendmentGuard({
    safety,
    source: initialMessages.source,
    messages,
    systemIngress: guardedInput.systemIngress,
  });

  const sourceSession = await materializeToolSources({
    dialect: dialect.id,
    resolved,
    materialize: dialect.materializeToolSource,
    runtimeContext: args.runtimeContext,
    abortSignal: args.signal,
  });
  resolved = sourceSession.resolved;
  selectRepresentationMiddleware(resolved, resolved.representations ?? []);
  let representationSelections: ReadonlyMap<string, number> | undefined;
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
      // Compile tool input schemas against the selected model's verified profile.
      // An unknown model (resolver present, returns undefined) fails before
      // transport for any schema'd tool rather than silently going permissive.
      toolInputCapabilities: resolveToolInputCapabilities(dialect, modelInfo),
      promptId: prompt.id,
      input: args.input ?? {},
      timeout: args.timeout,
      abortSignal: args.signal,
      modelIngress: safetySessionModelIngressGuard(safety, "tool"),
      memoryWriteGuard: safetySessionMemoryWriteGuard(safety),
      sdkModelIngress: dialect[toolModelIngressDialect],
      modelIngressProvider: modelInfo.provider,
      reresolve: async (skillSession) => {
        boundaryResolveOpts = withSkillActivationInput(
          resolveOpts,
          skillSession,
        );
        resolved = await prompt.resolve(boundaryResolveOpts);
        selectRepresentationSkills(
          resolved,
          resolved.representations ?? [],
          representationSelections,
        );
        selectRepresentationMiddleware(
          resolved,
          resolved.representations ?? [],
          representationSelections,
        );
        return resolved;
      },
      guardSkillAmendment,
    });
    await lifecycle.guardExposure({
      root: safetySessionToolDefinitionGuard(safety),
      descriptions: safetySessionToolDescriptionGuard(safety),
    });
    const resumed = await lifecycle.resume(messages);
    messages = resumed.messages;
    if (resumed.replayed > 0) nativeMessages = undefined;
  } catch (error) {
    await sourceSession.close();
    throw error;
  }
  const maxSteps =
    args.maxSteps ?? resolved.settings.maxSteps ?? DEFAULT_MAX_STEPS;
  let structuredPlan: StructuredOutputPlan | undefined;
  if (resolved.schema) {
    const capabilities = dialect.structuredOutput?.capabilities(modelInfo);
    if (!capabilities) {
      throw new CruxUnsupportedStructuredOutputError(
        dialect.id,
        `the selected model "${
          modelInfo.provider || modelInfo.modelId || "unknown"
        }" has no verified structured-output capability profile`,
      );
    }
    structuredPlan = compileStructuredOutputForRequest(
      resolved.schema,
      capabilities,
      {
        diagnostics: withDefaultResolverPorts().diagnostics,
        promptId: prompt.id,
      },
    );
  }
  const cachedFinalizer =
    resolved.schema && structuredPlan
      ? createCachedGenerateCandidateFinalizer({
          output: "object",
          safety,
          messages: () => messages,
          schema: resolved.schema,
          promptId: prompt.id ?? "unknown",
          structuredContext: {
            canonicalSchema: structuredPlan.canonicalSchema,
            decodeManifest: structuredPlan.decodeManifest,
          },
        })
      : createCachedGenerateCandidateFinalizer({
          output: "text",
          safety,
          messages: () => messages,
        });
  const planStep = createSdkRequestStepPlanner({
    dialect,
    prompt,
    resolveOptions: () => boundaryResolveOpts,
    resolved: () => resolved,
    rearm: (boundaryResolved) => lifecycle.rearm(boundaryResolved),
    configuredActiveTools: args.activeTools,
    stepBoundary: args[managedGenerationStepBoundary],
    inputBudget: args.inputBudget,
    prepareStep: args.prepareStep,
    requestInput: args.input ?? {},
    signal: args.signal,
    schema: resolved.schema,
    outputSchema: structuredPlan?.outputSchema,
    tools: () =>
      lifecycle.descriptors ? [...lifecycle.descriptors] : undefined,
    activeTools: activeToolNames,
    extra: args.extra,
    history: initialMessages.history,
    generateHistorySummary: sdkHistorySummaryGenerator(dialect),
    prepareRequest: (candidate, selections) => {
      selectRepresentationCapabilities(
        safety,
        resolved.representations ?? [],
        selections,
      );
      selectRepresentationSkills(
        resolved,
        resolved.representations ?? [],
        selections,
      );
      selectRepresentationMiddleware(
        resolved,
        resolved.representations ?? [],
        selections,
      );
      return guardRepresentedRequest(safety, candidate);
    },
    applyRepresentationSelection: async (selections) => {
      representationSelections = selections;
      selectRepresentationCapabilities(
        safety,
        resolved.representations ?? [],
        selections,
      );
      selectRepresentationSkills(
        resolved,
        resolved.representations ?? [],
        selections,
      );
      selectRepresentationMiddleware(
        resolved,
        resolved.representations ?? [],
        selections,
      );
      await lifecycle.rearm(resolved);
    },
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
        if ("system" in amendment) {
          currentSystem = amendment.system;
          currentSystemBlocks = amendment.systemBlocks;
        }
        factoryDirective = {
          kind: "amend",
          ...(amendment.system !== undefined
            ? { system: amendment.system }
            : {}),
          ...(amendment.systemBlocks !== undefined
            ? { systemBlocks: amendment.systemBlocks }
            : {}),
          ...(lifecycle.tools !== undefined ? { tools: lifecycle.tools } : {}),
          ...(amendment[systemMessagePrefixPatch] !== undefined
            ? {
                [systemMessagePrefixPatch]: amendment[systemMessagePrefixPatch],
              }
            : {}),
          refundStep: true,
        };
      }
      const callerDirective = await args.observer?.onStepEnd(step);
      return mergeDirectives(factoryDirective, callerDirective);
    },
  };

  const buildRequest = async (
    signal: AbortSignal | undefined,
  ): Promise<ExecutorRequest<TModel>> => {
    const providerMessages =
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
    emitInputTokenEstimate({
      messages: providerMessages ?? [],
      provider: modelInfo.provider,
      model: modelInfo.modelId,
      media: dialect.media,
    });
    if (args.prepareStep || args[managedGenerationStepBoundary]) {
      await planStep.prime({
        model: args.model,
        modelInfo,
        system: currentSystem,
        systemBlocks: currentSystemBlocks,
        messages:
          providerMessages ??
          (promptText ? [{ role: "user", content: promptText }] : []),
      });
    }
    return {
      model: args.model,
      modelInfo,
      planStep,
      system: currentSystem,
      systemBlocks: currentSystemBlocks,
      prompt: promptText,
      messages: providerMessages,
      nativeMessages,
      settings: mappedSettings,
      tools: lifecycle.tools,
      ...(lifecycle.toolWireSchemas
        ? { toolWireSchemas: lifecycle.toolWireSchemas }
        : {}),
      toolApproval: (call) =>
        lifecycle.requiresApproval(
          { id: call.toolCallId, name: call.toolName, args: call.input },
          call.messages ?? messages,
        ),
      activeTools: activeToolNames(),
      maxSteps,
      observer: loopObserver,
      ...(stepTransformer !== undefined ? { stepTransformer } : {}),
      abortSignal: composeAbortSignals(args.signal, signal),
      extra: args.extra,
    };
  };

  function activeToolNames(): readonly string[] | undefined {
    const visible =
      lifecycle.descriptors?.map((descriptor) => descriptor.name) ?? [];
    if (!args.activeTools) {
      return visible.length > 0 ? visible : undefined;
    }
    return visible.filter(
      (name) =>
        args.activeTools!.includes(name) || name === OFFLOAD_SUPPORT_TOOL_NAME,
    );
  }

  try {
    const generated = await sourceSession.withContext(async () =>
      orchestrateGenerateWithCompletion<
        Record<string, unknown>,
        AdapterExecutionGenerateResultWithoutRunId<TRawResponse>
      >(
        attachCachedCandidateFinalizer(
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
              tools: lifecycle.tools,
              input: args.input ?? {},
              ...(await previewForDevtools(
                prompt,
                resolveOpts,
                lifecycle.tools,
              )),
            },
            model: args.model,
            traceModel: modelInfo.modelId || undefined,
            input: args.input ?? {},
            provider: modelInfo.provider || dialect.id,
            resolved,
            outputMode: resolved.schema ? "object" : "text",
            timeout: args.timeout,
            ...(threadInvocation.override
              ? { threadHistoryOverride: threadInvocation.override }
              : {}),
          },
          cachedFinalizer,
        ),
        async () => {
          try {
            const result = resolved.schema
              ? await generateSdkStructured({
                  dialect,
                  args,
                  request: await buildRequest(undefined),
                  schema: resolved.schema,
                  plan: structuredPlan!,
                  safety,
                  retryId,
                  promptId: prompt.id,
                  maxSteps,
                  stepFacts,
                })
              : await (async () => {
                  stepBudget = createBudgetSignal({
                    budget: "step",
                    limitMs: args.timeout?.stepMs,
                  });
                  return generateLoop(await buildRequest(stepBudget.signal));
                })();
            result._meta = safety.stamp(result._meta);
            return result;
          } finally {
            stepBudget.dispose();
          }
        },
        async (result) => {
          const threadCommit = await checkpointAndCommitManagedGeneration(
            args,
            threadInvocation,
            result,
          );
          return threadCommit
            ? attachThreadCommit(result, threadCommit)
            : undefined;
        },
        async (result) => {
          await lifecycle.captureTurn({
            messages: result.messages,
            assistantText: result.text,
            toolCalls: result._meta.toolCalls,
          });
        },
      ),
    );

    return generated;
  } finally {
    await sourceSession.close();
  }

  /** Run the SDK text/tool loop and apply final-output safety regeneration. */
  async function generateLoop(
    request: ExecutorRequest<TModel>,
  ): Promise<AdapterExecutionGenerateResultWithoutRunId<TRawResponse>> {
    const outcome = await dialect.runTextLoop(request);

    if (outcome.status === "suspended") {
      const result = buildSuspendedResult(outcome);
      await finalizeSafetySessionLanguageOutput(
        safety,
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
    const finalOutput = await finalizeSafetySessionLanguageOutput(
      safety,
      { text: finalText, parsed: undefined },
      async (corrective, writeback) => {
        const guardedWriteback = await guardCorrectiveWriteback({
          ...writeback,
          corrective,
          guard: safetySessionFeedbackGuard(safety),
        });
        const regenMessages: Message[] = [
          ...replaceFinalAssistantOutput(
            resultMessages,
            guardedWriteback.rejectedOutput,
          ),
          ...guardedWriteback.corrective,
        ];
        const regenRequest: ExecutorRequest<TModel> = {
          ...request,
          prompt: undefined,
          messages: regenMessages,
          nativeMessages: undefined,
          maxSteps: 1,
          observer: undefined,
        };
        const regen = await dialect.runTextLoop(regenRequest);
        if (regen.status === "complete") {
          if (resultStepFacts.length > 0) {
            const previous = resultStepFacts[resultStepFacts.length - 1]!;
            resultStepFacts[resultStepFacts.length - 1] = {
              ...previous,
              content: [],
            };
          }
          finalText = regen.response.text;
          finalRaw = regen.raw;
          finalResponse = regen.response;
          finalCostUsd = regen.meta.costUsd;
          resultMessages = [...regen.messages];
          resultStepFacts.push(
            ...(regen.stepFacts ?? [sdkResponseFacts(regen.response)]),
          );
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
          content: [{ type: "text", text: finalText }],
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
  ): AdapterExecutionGenerateResultWithoutRunId<TRawResponse> {
    const sealed = lifecycle.suspend(
      outcome.pendingApprovals,
      outcome.assistantResponse,
      outcome.messages,
    );
    return finalizeSdkResultEnvelope<TRawResponse>({
      raw: undefined,
      // The suspension marker lives on `_meta.finishReason` (the documented
      // public signal), not on the normalized `AdapterResponse.finishReason`.
      response: outcome.assistantResponse,
      text: outcome.assistantResponse.text,
      _meta: {
        ...buildTraceMeta({ response: outcome.assistantResponse }),
        finishReason: "tool_approval_required",
      },
      messages: sealed.messages,
      pendingApprovals: sealed.requests,
      stepFacts,
    });
  }
}
