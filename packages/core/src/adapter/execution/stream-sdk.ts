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
import {
  createSafetyWithBindingApplicability,
  defaultConstraintFeedbackFormatter,
  guardSafetySessionResolvedInput,
  openSafetySessionStructuredStream,
  safetyDefersDownstreamOutput,
  safetyDefersReasoning,
  safetySessionFeedbackGuard,
  openSafetySessionStreamRaw,
  openSafetySessionStructuredStreamRaw,
  safetySessionMemoryWriteGuard,
  safetySessionModelIngressGuard,
  safetySessionStreamCommitPlan,
  safetySessionToolDefinitionGuard,
  safetySessionToolDescriptionGuard,
} from "../../safety/session";
import { createCoordinatedStreamPlan } from "./stream-attempt-plan-factory";
import { languageBindingApplicability } from "../../safety/language-applicability";
import { orchestrateStream } from "../../generation/orchestrate";
import { runInStreamObservationContext } from "../../generation/stream-observability";
import {
  composeAbortSignals,
  createBudgetSignal,
} from "../../generation/timeout";
import { normalizeInvocationMessages } from "../../content/invocation-message";
import { assertProviderMediaSupported } from "../native-chat/media-hooks";
import { withDefaultResolverPorts } from "../../resolver/ports";
import type {
  ExecutorRequest,
  ExecutorProviderStreamHandle,
  ExecutorStreamCompletionPayload,
  ExecutorStreamHandle,
  ExecutorStreamMeta,
} from "../executor-types";
import {
  compileStructuredOutputForRequest,
  CruxUnsupportedStructuredOutputError,
} from "../structured-output";
import type {
  JsonSchemaObject,
  StructuredOutputDecodeManifest,
} from "../structured-output";
import { withOperationResultMeta } from "../../observability/internal/result-meta";
import type { CruxRunId, WithOperationResultMeta } from "../../observability";
import { stampCruxRunId } from "../../generation/run-id";
import { createToolLifecycle } from "../tool/session";
import type { AdapterExecutionStreamArgs, SdkLoopDialect } from "./types";
import { initialMessageState } from "./messages";
import { sdkHistorySummaryGenerator } from "./history-summary";
import {
  buildResolveOpts,
  DEFAULT_MAX_STEPS,
  inspectForDevtools,
  resolveToolInputCapabilities,
  withSkillActivationInput,
} from "./shared";
import { emitInputTokenEstimate } from "./media-token-budget";
import { materializeToolSources } from "./tool-sources";
import { createStreamSourceCleanup } from "./stream-source-cleanup";
import { toolModelIngressDialect } from "../tool/model-ingress-port";
import {
  guardStreamCompletion,
  trackSafetyStreamSeal,
} from "./stream-completion";
import {
  lazyCompletionPromise,
  operationMetaWithLegacyCompletion,
  replaceLegacyStreamCompletion,
} from "./stream-legacy-completion";
import { attachCachedCandidateFinalizer } from "../../runtime/internal/cached-candidate-finalizer";
import { readCachedReleaseSeal } from "../../runtime/internal/cached-release-seal";
import { createCachedStreamCandidateFinalizer } from "./cached-stream-candidate";
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
  assertSdkRequestPlanning(dialect);
  const resolveOpts = buildResolveOpts({
    input: args.input,
    provider: modelInfo.provider,
    modelId: modelInfo.modelId,
    settings: args.settings,
  });
  let resolved = await prompt.resolve(resolveOpts);
  const diagnostics = withDefaultResolverPorts().diagnostics;
  const mappedSettings = dialect.mapSettings(resolved.settings, modelInfo);
  const initialMessages = initialMessageState(
    resolved,
    args.messages,
    args.nativeMessages,
  );
  let { messages, promptText } = initialMessages;
  let nativeMessages = initialMessages.history?.changed
    ? undefined
    : args.nativeMessages;
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
  selectRepresentationCapabilities(
    safety,
    resolved.representations ?? [],
  );
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
  if (guardedInput.system !== currentSystem) currentSystemBlocks = undefined;
  currentSystem = guardedInput.system;

  // `result.cancel()` must reach the provider, not merely detach readers. The
  // caller's own signal already flows into the call; this controller gives the
  // published result the same authority without inventing a second one.
  const cancellation = new AbortController();
  const callerSignal = composeAbortSignals(args.signal, cancellation.signal);
  const sourceSession = await materializeToolSources({
    dialect: dialect.id,
    resolved,
    materialize: dialect.materializeToolSource,
    runtimeContext: args.runtimeContext,
    abortSignal: args.signal,
  });
  resolved = sourceSession.resolved;
  selectRepresentationMiddleware(resolved, resolved.representations ?? []);
  const closeSources = createStreamSourceCleanup(sourceSession, args.signal);
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
        resolved = await prompt.resolve(
          withSkillActivationInput(resolveOpts, skillSession),
        );
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
    });
    await lifecycle.guardExposure({
      root: safetySessionToolDefinitionGuard(safety),
      descriptions: safetySessionToolDescriptionGuard(safety),
    });
    const resumed = await lifecycle.resume(messages);
    messages = resumed.messages;
    if (resumed.replayed > 0) nativeMessages = undefined;
  } catch (error) {
    await closeSources();
    throw error;
  }
  const tools = lifecycle.tools;
  // Text streams gate here; the structured stream is created after compilation
  // below (it needs the canonical schema + decode manifest).
  let trackedSafety =
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

  // Core owns compilation: resolve the model's inert capabilities and compile
  // the wire schema before transport. An unknown model fails here rather than
  // sending the authored schema. The SDK validates against `outputSchema`; core
  // owns the authored parse of the completed stream value.
  let structuredOutputSchema: JsonSchemaObject | undefined;
  let structuredDecodeManifest: StructuredOutputDecodeManifest | undefined;
  let structuredCanonicalSchema: JsonSchemaObject | undefined;
  if (resolved.schema) {
    const capabilities = dialect.structuredOutput?.capabilities(modelInfo);
    if (!capabilities) {
      stepBudget.dispose();
      await closeSources();
      throw new CruxUnsupportedStructuredOutputError(
        dialect.id,
        `the selected model "${
          modelInfo.provider || modelInfo.modelId || "unknown"
        }" has no verified structured-output capability profile`,
      );
    }
    const plan = compileStructuredOutputForRequest(
      resolved.schema,
      capabilities,
      { diagnostics, promptId: prompt.id },
    );
    structuredOutputSchema = plan.outputSchema;
    structuredDecodeManifest = plan.decodeManifest;
    structuredCanonicalSchema = plan.canonicalSchema;
  }
  const cachedFinalizer =
    resolved.schema && structuredCanonicalSchema
      ? createCachedStreamCandidateFinalizer({
          output: "object",
          safety,
          messages: () => messages,
          schema: resolved.schema,
          promptId: prompt.id ?? "unknown",
          structuredContext: {
            canonicalSchema: structuredCanonicalSchema,
            decodeManifest: structuredDecodeManifest,
          },
        })
      : createCachedStreamCandidateFinalizer({
          output: "text",
          safety,
          messages: () => messages,
        });

  // Structured streaming drives the scanner-fed occurrence stream so provider
  // wire JSON is canonicalized (manifest-decoded) and object-gated before
  // `Output.object` parses it. Created even when Safety has no guardrails if the
  // decode manifest requires canonicalization.
  if (
    resolved.schema &&
    (safety.enabled || (structuredDecodeManifest?.operations.length ?? 0) > 0)
  ) {
    trackedSafety = trackSafetyStreamSeal(
      openSafetySessionStructuredStream(safety, {
        ...(structuredCanonicalSchema
          ? { canonicalSchema: structuredCanonicalSchema }
          : {}),
        ...(structuredDecodeManifest
          ? { decodeManifest: structuredDecodeManifest }
          : {}),
      }),
    );
  }

  // A commit gate (enforce `assert`, or a positive `validationRetry`) can REJECT an
  // attempt, so the stream must be able to discard it and restream. Core owns that
  // policy through the plan; the runtime owns how attempts are physically streamed and
  // composed. Runtimes that do not declare `coordinatedStream` keep the single-attempt
  // path (where a rejection fails closed).
  const sdkValidationGate =
    resolved.schema !== undefined &&
    (args.validationRetry?.maxRetries ?? 0) > 0;
  const sdkCommitGate =
    (safety.enabled && safetySessionStreamCommitPlan(safety).hasAssertGate) ||
    sdkValidationGate;
  let sdkSteps = 0;
  const streamPlan =
    sdkCommitGate && dialect.capabilities?.coordinatedStream
      ? createCoordinatedStreamPlan({
          active: true,
          openAttemptSafety: () =>
            resolved.schema
              ? openSafetySessionStructuredStreamRaw(safety, {
                  ...(structuredCanonicalSchema
                    ? { canonicalSchema: structuredCanonicalSchema }
                    : {}),
                  ...(structuredDecodeManifest
                    ? { decodeManifest: structuredDecodeManifest }
                    : {}),
                })
              : // RAW, not `safety.openStream()`: the coordinated route owns retry
                // authority, so a text assert must raise the non-terminal rejection for
                // the plan rather than failing closed inside the safety stream. Using the
                // fail-closed entry here made a text assert terminate on its first failure
                // on this route while the native route retried.
                openSafetySessionStreamRaw(safety),
          bufferUntilValidated: sdkValidationGate,
          ...(resolved.schema ? { schema: resolved.schema } : {}),
          maxSteps:
            args.maxSteps ?? resolved.settings.maxSteps ?? DEFAULT_MAX_STEPS,
          steps: () => sdkSteps,
          incrementStep: () => {
            sdkSteps += 1;
          },
          formatFeedback: (failures) => {
            const formatted = defaultConstraintFeedbackFormatter.format(
              failures,
              {
                promptId: prompt.id,
                model: modelInfo.modelId,
                traceId: undefined,
                metadata: {},
              },
            );
            return typeof formatted === "string"
              ? [{ role: "user", content: formatted }]
              : formatted;
          },
          guardFeedback: safetySessionFeedbackGuard(safety),
          ...(args.validationRetry && sdkValidationGate
            ? { validationRetry: args.validationRetry }
            : {}),
          ...(prompt.id ? { promptId: prompt.id } : {}),
          ...(callerSignal ? { signal: callerSignal } : {}),
        })
      : undefined;
  const planStep = createSdkRequestStepPlanner({
    dialect,
    settings: resolved.settings,
    inputBudget: args.inputBudget,
    schema: resolved.schema,
    outputSchema: structuredOutputSchema,
    tools: () =>
      lifecycle.descriptors ? [...lifecycle.descriptors] : undefined,
    activeTools: activeToolNames,
    extra: args.extra,
    history: initialMessages.history,
    generateHistorySummary: sdkHistorySummaryGenerator(dialect),
    representations: () => resolved.representations,
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

  const request: ExecutorRequest<TModel> & {
    schema?: z.ZodType;
    outputSchema?: JsonSchemaObject;
  } = {
    model: args.model,
    modelInfo,
    planStep,
    system: currentSystem,
    systemBlocks: currentSystemBlocks,
    prompt: promptText,
    messages: providerMessages,
    nativeMessages,
    settings: mappedSettings,
    tools,
    ...(lifecycle.toolWireSchemas
      ? { toolWireSchemas: lifecycle.toolWireSchemas }
      : {}),
    toolApproval: (call) =>
      lifecycle.requiresApproval(
        { id: call.toolCallId, name: call.toolName, args: call.input },
        call.messages ?? messages,
      ),
    activeTools: activeToolNames(),
    maxSteps: args.maxSteps ?? resolved.settings.maxSteps ?? DEFAULT_MAX_STEPS,
    observer: args.observer,
    abortSignal: composeAbortSignals(callerSignal, stepBudget.signal),
    extra: args.extra,
    diagnostics,
    // A coordinated stream drives per-attempt Safety through the plan instead; the
    // single shared `safety` stream would leak a discarded attempt's state across
    // attempts, so the two are mutually exclusive.
    ...(streamPlan
      ? { streamPlan }
      : trackedSafety
        ? { safety: trackedSafety.stream }
        : {}),
    ...(resolved.schema ? { schema: resolved.schema } : {}),
    ...(structuredOutputSchema ? { outputSchema: structuredOutputSchema } : {}),
  };

  function activeToolNames(): readonly string[] | undefined {
    const visible =
      lifecycle.descriptors?.map((descriptor) => descriptor.name) ?? [];
    if (!args.activeTools) {
      return visible.length > 0 ? visible : undefined;
    }
    return visible.filter(
      (name) =>
        args.activeTools!.includes(name) ||
        name === OFFLOAD_SUPPORT_TOOL_NAME,
    );
  }

  let handle: WithOperationResultMeta<
    ExecutorProviderStreamHandle<TRawStream>
  > & { readonly runId: CruxRunId };
  try {
    handle = await sourceSession.withContext(async () =>
      orchestrateStream<
        Record<string, unknown>,
        ExecutorProviderStreamHandle<TRawStream>
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
                    dialect.replayStream!(
                      cached,
                    ) as unknown as MiddlewareResult,
                }
              : {}),
          },
          cachedFinalizer,
        ),
        async () => {
          emitInputTokenEstimate({
            messages: providerMessages ?? [],
            provider: modelInfo.provider,
            model: modelInfo.modelId,
            media: dialect.media,
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

  const cachedRelease = readCachedReleaseSeal(handle);
  const innerCompletion = handle.completion.bind(handle);
  const wrappedCompletion = async (): Promise<
    ExecutorStreamMeta | undefined
  > => {
    try {
      const meta = await innerCompletion();
      // The safety stream (text or structured) already guarded the released text
      // live — object occurrences and `model.output.text` alike — so completion
      // treats it as represented and does not re-guard it. For a structured stream
      // `meta.text` is the canonical text the transform released. On a coordinated
      // stream the seal comes from the ACCEPTED attempt (a discarded attempt's seal
      // is never published).
      const acceptedSeal = streamPlan?.acceptedSeal();
      const sealedLive = streamPlan
        ? acceptedSeal !== undefined
        : (trackedSafety?.sealed() ?? false);
      const guarded = await guardStreamCompletion({
        safety,
        meta,
        assembleWithoutSafety: false,
        ...(cachedRelease ? { cachedRelease } : {}),
        liveText: streamPlan
          ? (acceptedSeal?.text ?? meta?.text)
          : trackedSafety
            ? (trackedSafety.sealedText() ?? meta?.text)
            : undefined,
        representedText: streamPlan || trackedSafety ? meta?.text : undefined,
        messages,
        ...(resolved.schema
          ? {
              schema: resolved.schema,
              decodeManifest: structuredDecodeManifest,
              ...(structuredCanonicalSchema
                ? {
                    structuredContext: {
                      canonicalSchema: structuredCanonicalSchema,
                      decodeManifest: structuredDecodeManifest,
                    },
                  }
                : {}),
              // The structured stream already canonicalized + object-gated + sealed
              // the value: consume it directly (no re-decode, no re-gate).
              ...(sealedLive
                ? {
                    ...(streamPlan?.committedCandidate()
                      ? { committedCandidate: streamPlan.committedCandidate() }
                      : {}),
                    sealedCanonicalValue: streamPlan
                      ? acceptedSeal?.parsed
                      : trackedSafety?.sealedObject(),
                    objectOccurrencesAlreadyGated: true,
                    // Occurrence-precise settlement from the accepted attempt only.
                    ...(acceptedSeal?.settlement
                      ? {
                          constraintSettlement: acceptedSeal.settlement.settled,
                        }
                      : {}),
                  }
                : {}),
              promptId: prompt.id,
            }
          : {}),
      });
      await runInStreamObservationContext(handle, () =>
        lifecycle.captureTurn({
          messages,
          assistantText: guarded?.text,
          toolCalls: guarded?.toolCalls,
        }),
      );
      return guarded
        ? stampCruxRunId(
            withOperationResultMeta(
              guarded as ExecutorStreamCompletionPayload,
              handle._meta,
            ),
            handle.runId,
          )
        : undefined;
    } finally {
      stepBudget.dispose();
      await closeSources();
    }
  };

  let completion: Promise<ExecutorStreamMeta | undefined> | undefined;
  const getCompletion = (): Promise<ExecutorStreamMeta | undefined> => {
    if (completion) return completion;
    completion = wrappedCompletion();
    void completion.catch(() => undefined);
    return completion;
  };
  const legacyCompletion = lazyCompletionPromise(getCompletion);
  const hasLegacyCompletion = replaceLegacyStreamCompletion(
    handle.raw,
    legacyCompletion,
  );
  const publicMeta = hasLegacyCompletion
    ? operationMetaWithLegacyCompletion(handle._meta, legacyCompletion)
    : handle._meta;
  return {
    runId: handle.runId,
    raw: handle.raw,
    ...(handle.routing !== undefined ? { routing: handle.routing } : {}),
    structured: resolved.schema !== undefined,
    deferMedia: safetyDefersDownstreamOutput(safety),
    deferReasoning: safetyDefersReasoning(safety),
    abort: (reason: unknown) => cancellation.abort(reason),
    ...(callerSignal ? { signal: callerSignal } : {}),
    _meta: publicMeta,
    completion: getCompletion,
  };
}
