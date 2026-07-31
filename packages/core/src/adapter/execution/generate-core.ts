/**
 * Core-step non-streaming execution.
 *
 * This module owns the Crux-driven adapter dialect: Crux resolves prompts,
 * drives each provider call, executes tool rounds, performs structured-output
 * retry, applies safety, stamps metadata, and captures memory after the run.
 *
 * @internal
 * @module
 */

import type { GenerationMeta } from "../../generation/types";
import type { Message } from "../../generation/messages";
import type { AssistantContentPart } from "../../types/content";
import {
  findTriggeredStopCondition,
  normalizeStopConditions,
  type StopCondition,
} from "../../generation/tool-control";
import { getHooks } from "../../runtime/runtime";
import {
  createSafetyWithBindingApplicability,
  finalizeSafetySessionLanguageOutput,
  guardSafetySessionLanguageStep,
  guardSafetySessionResolvedInput,
  safetySessionFeedbackGuard,
  safetySessionMemoryWriteGuard,
  safetySessionModelIngressGuard,
  safetySessionToolDefinitionGuard,
  safetySessionToolDescriptionGuard,
} from "../../safety/session";
import type { SafetyOutput } from "../../safety/session";
import {
  compileStructuredOutputForRequest,
  CruxUnsupportedStructuredOutputError,
} from "../structured-output";
import { withDefaultResolverPorts } from "../../resolver/ports";
import type {
  JsonSchemaObject,
  StructuredOutputDecodeManifest,
} from "../structured-output";
import { createStructuredCompletion } from "./structured-completion";
import { languageBindingApplicability } from "../../safety/language-applicability";
import { orchestrateGenerateWithCompletion } from "../../generation/orchestrate";
import { composeAbortSignals, withBudget } from "../../generation/timeout";
import { normalizeAdapterCallError } from "../normalized-outcome";
import { normalizeInvocationMessages } from "../../content/invocation-message";
import { assertProviderMediaSupported } from "../native-chat/media-hooks";
import { emitInputTokenEstimate } from "./media-token-budget";
import type { AdapterResponse, CallArgs } from "../types";
import { responseContent } from "../assistant-output";
import {
  createResultAccumulator,
  type ResultStepFacts,
} from "../result-accumulator";
import { createToolLifecycle } from "../tool/session";
import type { ApprovalRequestInfo } from "../tool/approval";
import type {
  AdapterExecutionGenerateArgs,
  AdapterExecutionGenerateResult,
  CoreStepDialect,
  ObservedAdapterExecutionGenerateResult,
} from "./types";
import {
  appendAssistantResultMessage,
  initialCoreMessageState,
} from "./messages";
import { coreHistorySummaryGenerator } from "./history-summary";
import {
  buildResolveOpts,
  DEFAULT_MAX_STEPS,
  withSkillActivationInput,
} from "./shared";
import { materializeToolSources } from "./tool-sources";
import {
  replaceResponseContent,
  replaceResponseText,
  replaceResponseTranscriptText,
} from "./response-text";
import { createSkillIngressAmendmentGuard } from "./skill-ingress-amendment";
import { guardCorrectiveWriteback } from "../../safety/session-feedback-guard";
import {
  applySystemMessagePrefixPatch,
  systemMessagePrefixPatch,
} from "./system-prefix-patch";
import { createCachedGenerateCandidateFinalizer } from "./cached-generate-candidate";
import { attachCachedCandidateFinalizer } from "../../runtime/internal/cached-candidate-finalizer";
import { attachCachedStructuredCandidate } from "../../runtime/internal/cached-structured-candidate";
import { sealRequest } from "../../request/planner/seal";
import { createRequestRepresentationEpoch } from "../../request/planner/epoch";
import {
  guardRepresentedRequest,
  selectRepresentationCapabilities,
  selectRepresentationMiddleware,
  selectRepresentationSkills,
} from "./representation-safety";
import type { SealedRequestPlan } from "../../request/planner/plan";
import {
  recordRequestRetryCount,
  type RequestReceipt,
} from "../../request/receipt/receipt";
import {
  createPrepareStepState,
  recordPrepareStepOutcome,
  runPrepareStep,
} from "../../request/prepare/step";
import {
  resolveExecutionAmendment,
  type ResolvedExecutionAmendment,
} from "../../request/prepare/amendment";
import {
  createPreparationResources,
  preparationResourceReads,
  type PreparationResources,
} from "../../request/prepare/resources";
import type { ExecutionAmendment } from "../../request/prepare/amendment";
import { commitPreparationDecision } from "../../request/prepare/journal";
import type { StepReason } from "../../request/prepare/step-context";

/**
 * Execute one prompt through the core-owned provider loop.
 *
 * The dialect contributes only provider mechanics. This function owns the
 * order-sensitive Crux policy around those mechanics: prompt resolution,
 * approval resume replay, input/output safety, validation retry, skill-load
 * refunds, orchestration middleware, trace metadata, and memory capture.
 *
 * @param dialect - Normalized core-step dialect for one bound provider client.
 * @param args - Prepared execution arguments from the public `adapter()` facade.
 * @returns The normalized non-streaming adapter result.
 */
export async function generateCore<
  TClient,
  TRawResponse,
  TRawStream,
  TExtra extends Record<string, unknown>,
>(
  dialect: CoreStepDialect<TClient, TRawResponse, TRawStream, TExtra>,
  args: AdapterExecutionGenerateArgs<string, TExtra>,
): Promise<ObservedAdapterExecutionGenerateResult<TRawResponse>> {
  const prompt = args.prompt;
  const modelInfo = args.modelInfo ?? {
    provider: args.provider ?? dialect.id,
    modelId: args.model,
  };
  const resolveOpts = buildResolveOpts({
    input: args.input,
    provider: args.provider ?? modelInfo.provider,
    modelId: modelInfo.modelId,
    settings: args.settings,
  });
  let boundaryResolveOpts = resolveOpts;
  let resolved = await prompt.resolve(resolveOpts);
  const mappedSettings = dialect.mapSettings(resolved.settings);

  const initialMessages = initialCoreMessageState(resolved, args.messages);
  let messages = initialMessages.messages;
  let outputSchema: JsonSchemaObject | undefined;
  let decodeManifest: StructuredOutputDecodeManifest | undefined;
  let canonicalSchema: JsonSchemaObject | undefined;
  if (resolved.schema) {
    if (!dialect.structuredOutput) {
      throw new CruxUnsupportedStructuredOutputError(dialect.id);
    }
    const plan = compileStructuredOutputForRequest(
      resolved.schema,
      dialect.structuredOutput.accepts,
      {
        diagnostics: withDefaultResolverPorts().diagnostics,
        promptId: prompt.id,
      },
    );
    outputSchema = plan.outputSchema;
    decodeManifest = plan.decodeManifest;
    canonicalSchema = plan.canonicalSchema;
  }

  const maxSteps =
    args.maxSteps ?? resolved.settings.maxSteps ?? DEFAULT_MAX_STEPS;
  const stopConditions = normalizeStopConditions(resolved.settings, maxSteps);
  let lastRaw: TRawResponse | undefined;
  let lastExtracted: AdapterResponse | undefined;
  let parsedObject: unknown;
  let acceptedCanonicalInput: unknown;
  let pendingApprovals: readonly ApprovalRequestInfo[] | undefined;
  let stoppedBy: StopCondition | undefined;
  let steps = 0;
  let providerResponseOrdinal = 0;
  const stepFacts: ResultStepFacts[] = [];
  let lastRequestReceipt: RequestReceipt | undefined;
  const prepareStepState = createPrepareStepState();
  const representationEpoch = createRequestRepresentationEpoch();
  const validationRetry = args.validationRetry;
  const maxValidationRetries = validationRetry?.maxRetries ?? 0;
  let validationRetries = 0;
  const retryId = validationRetry
    ? `vr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    : "";
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
      traceId: retryId || undefined,
      systemPrompt: resolved.system,
    },
    languageBindingApplicability(resolved.schema !== undefined),
  );
  const cachedFinalizer = resolved.schema
    ? createCachedGenerateCandidateFinalizer({
        output: "object",
        safety,
        messages: () => messages,
        schema: resolved.schema,
        promptId: prompt.id ?? "unknown",
        structuredContext: {
          canonicalSchema,
          decodeManifest,
        },
      })
    : createCachedGenerateCandidateFinalizer({
        output: "text",
        safety,
        messages: () => messages,
      });

  let currentSystem = resolved.system;
  let currentSystemBlocks = resolved.systemBlocks;
  const prepareProviderMessages = async (canonical: readonly Message[]) => {
    const normalized = await normalizeInvocationMessages(canonical, {
      provider: modelInfo.provider,
    });
    assertProviderMediaSupported(
      { providerId: dialect.id, media: dialect.media },
      {
        provider: modelInfo.provider,
        model: modelInfo.modelId,
        messages: normalized,
      },
    );
    return normalized;
  };
  selectRepresentationCapabilities(safety, resolved.representations ?? []);
  selectRepresentationSkills(resolved, resolved.representations ?? []);
  const guardedInput = await guardSafetySessionResolvedInput(
    safety,
    resolved,
    {
      messages,
      system: currentSystem,
    },
    {
      resolvedMessages:
        initialMessages.source === "resolved-messages"
          ? "selected"
          : "discarded",
    },
  );
  messages = [...guardedInput.messages];
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
      abortSignal: args.signal,
      modelIngress: safetySessionModelIngressGuard(safety, "tool"),
      memoryWriteGuard: safetySessionMemoryWriteGuard(safety),
      reresolve: async (skillSession) => {
        boundaryResolveOpts = withSkillActivationInput(
          resolveOpts,
          skillSession,
        );
        resolved = await prompt.resolve(
          boundaryResolveOpts,
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
      guardSkillAmendment,
      appendToolRound: dialect.appendToolRound,
      sanitizeToolSchema: dialect.sanitizeToolSchema,
      ...(dialect.structuredOutput
        ? { structuredOutputCapabilities: dialect.structuredOutput.accepts }
        : {}),
    });
    await lifecycle.guardExposure({
      root: safetySessionToolDefinitionGuard(safety),
      descriptions: safetySessionToolDescriptionGuard(safety),
    });
    messages = (await lifecycle.resume(messages)).messages;
  } catch (error) {
    await sourceSession.close();
    throw error;
  }

  /**
   * Run exactly one provider call under the step budget, normalizing any thrown
   * SDK/timeout/abort error into a {@link CruxAdapterError} so a failure surfaces
   * as a classified outcome instead of a raw provider exception.
   */
  const callProvider = (callArgs: CallArgs<TExtra>) =>
    withBudget(
      (signal) =>
        dialect.call(dialect.client, callArgs, {
          signal: composeAbortSignals(args.signal, signal),
        }),
      { budget: "step", limitMs: args.timeout?.stepMs },
    ).catch((error: unknown) => {
      throw normalizeAdapterCallError(error, {
        providerId: dialect.id,
        signal: args.signal,
        mapError: dialect.mapError,
      });
    });
  const generateHistorySummary = coreHistorySummaryGenerator(
    dialect,
    callProvider,
  );

  const sealProviderRequest = async (
    request: CallArgs<TExtra>,
    boundary: PreparedCoreBoundary,
  ): Promise<SealedRequestPlan<TExtra>> => {
    const sealed = await sealRequest({
      provider: modelInfo.provider,
      model: boundary.model,
      request,
      settings: boundary.resolved.settings,
      inputBudget: boundary.inputBudget,
      capacity: dialect.capacity,
      countTokens: dialect.countTokens
        ? (candidate) => dialect.countTokens!(dialect.client, candidate)
        : undefined,
      media: dialect.media,
      previousRequestId: lastRequestReceipt?.id,
      history: initialMessages.history,
      generateHistorySummary,
      representations: boundary.resolved.representations,
      metadata: boundary.resolved.metadata,
      representationEpoch,
      prepareRequest: (candidate, selections) => {
        selectRepresentationCapabilities(
          safety,
          boundary.resolved.representations ?? [],
          selections,
        );
        selectRepresentationSkills(
          boundary.resolved,
          boundary.resolved.representations ?? [],
          selections,
        );
        selectRepresentationMiddleware(
          boundary.resolved,
          boundary.resolved.representations ?? [],
          selections,
        );
        return guardRepresentedRequest(safety, candidate);
      },
      applyRepresentationSelection: async (selections) => {
        representationSelections = selections;
        selectRepresentationCapabilities(
          safety,
          boundary.resolved.representations ?? [],
          selections,
        );
        selectRepresentationSkills(
          boundary.resolved,
          boundary.resolved.representations ?? [],
          selections,
        );
        selectRepresentationMiddleware(
          boundary.resolved,
          boundary.resolved.representations ?? [],
          selections,
        );
        await lifecycle.rearm(boundary.resolved);
      },
    });
    if (boundary.decision) {
      commitPreparationDecision({
        receipt: sealed.receipt,
        requestId: sealed.receipt.id,
        stepIndex: boundary.decision.stepIndex,
        reason: boundary.decision.reason,
        amendment: boundary.decision.amendment,
        resources: preparationResourceReads(boundary.decision.resources),
      });
    }
    lastRequestReceipt = sealed.receipt;
    return sealed;
  };

  const prepareBoundary = async (
    boundaryMessages: readonly Message[],
    reason: "initial" | "tool-result" | "validation-retry",
  ): Promise<PreparedCoreBoundary> => {
    if (!args.prepareStep) {
      return Object.freeze({
        resolved,
        model: modelInfo.modelId,
        inputBudget: args.inputBudget,
        activeTools: args.activeTools,
      });
    }
    const resources = createPreparationResources({
      entries: prompt.contexts,
      requestInput: args.input ?? {},
      promptId: prompt.id,
    });
    const amendment = await runPrepareStep({
      callback: args.prepareStep,
      state: prepareStepState,
      requestInput: args.input ?? {},
      reason,
      previousReceipt: lastRequestReceipt,
      messages: boundaryMessages,
      resources,
      signal: args.signal,
    });
    const boundary = await resolveExecutionAmendment({
      prompt,
      resolveOptions: boundaryResolveOpts,
      baseline: resolved,
      amendment,
      model: modelInfo.modelId,
      inputBudget: args.inputBudget,
      baselineActiveTools: args.activeTools,
      resources,
    });
    await lifecycle.rearm(boundary.resolved);
    return Object.freeze({
      ...boundary,
      decision: {
        amendment,
        resources,
        stepIndex: prepareStepState.index - 1,
        reason,
      },
    });
  };

  const generated = await sourceSession
    .withContext(() =>
      orchestrateGenerateWithCompletion(
        attachCachedCandidateFinalizer(
          {
            promptId: prompt.id,
            promptConfig: prompt.config ?? ({} as typeof prompt.config),
            preparedArgs: {
              model: modelInfo.modelId,
              system: currentSystem,
              systemBlocks: currentSystemBlocks,
              messages,
              settings: mappedSettings,
              schema: resolved.schema,
              outputSchema,
              tools: lifecycle.descriptors,
              extra: (args.extra ?? {}) as TExtra,
              input: args.input ?? {},
            },
            model: modelInfo.modelId,
            input: args.input ?? {},
            provider: modelInfo.provider,
            resolved,
            outputMode: resolved.schema ? "object" : "text",
            timeout: args.timeout,
          },
          cachedFinalizer,
        ),
        async () => {
          let lastCallArgs: CallArgs<TExtra> | undefined;
          let suspendedApproval = false;

          for (let step = 0; step < maxSteps; step++) {
            steps++;
            const providerMessages = await prepareProviderMessages(messages);
            const boundary = await prepareBoundary(
              providerMessages,
              lastRequestReceipt ? "tool-result" : "initial",
            );
            emitInputTokenEstimate({
              messages: providerMessages,
              provider: modelInfo.provider,
              model: boundary.model,
              media: dialect.media,
            });
            const boundaryTools = selectedDescriptors(
              lifecycle.descriptors,
              boundary.activeTools,
            );
            const callArgs: CallArgs<TExtra> = {
              model: boundary.model,
              system:
                boundary.resolved === resolved
                  ? currentSystem
                  : boundary.resolved.system,
              systemBlocks:
                boundary.resolved === resolved
                  ? currentSystemBlocks
                  : boundary.resolved.systemBlocks,
              messages: providerMessages,
              settings:
                boundary.resolved === resolved
                  ? mappedSettings
                  : dialect.mapSettings(boundary.resolved.settings),
              schema: boundary.resolved.schema,
              outputSchema,
              tools: boundaryTools,
              extra: (args.extra ?? {}) as TExtra,
            };
            const sealed = await sealProviderRequest(callArgs, boundary);
            lastCallArgs = sealed.request;

            const { raw, extracted } = await callProvider(lastCallArgs);
            recordPrepareStepOutcome(prepareStepState, {
              usage: extracted.usage,
              transportRetries: extracted.transportRetries,
            });
            recordRequestRetryCount(sealed.receipt, extracted.transportRetries);
            lastRaw = raw;
            const providerStep = stepFactsFromResponse(extracted);
            const guardedStep = await guardSafetySessionLanguageStep(
              safety,
              providerResponseOrdinal++,
              providerStep,
              resolved.schema,
            );
            lastExtracted = sameStepContent(
              providerStep.content,
              guardedStep.content,
            )
              ? extracted
              : replaceResponseContent(extracted, guardedStep.content);

            if (lastExtracted.toolCalls && lastExtracted.toolCalls.length > 0) {
              // Tool calls are handled below.
            } else {
              // A completed candidate. Structured validation is unconditional and
              // runs once, after terminal guardrails, in the finalize step below —
              // never gated on validation-retry configuration.
              rememberStep(lastExtracted);
              break;
            }

            if (
              !lastExtracted.toolCalls ||
              lastExtracted.toolCalls.length === 0
            )
              continue;
            const round = await lifecycle.executeRound(lastExtracted, messages);
            messages = round.messages;
            if (round.kind === "suspended") {
              // Suspension is tracked separately; the provider-normalized finish
              // reason on the tool-call turn (e.g. "tool-calls") stays truthful.
              suspendedApproval = true;
              pendingApprovals = [round.request];
              rememberStep(lastExtracted);
              break;
            }
            const amendment = await lifecycle.applySkillLoads(
              lastExtracted.toolCalls,
            );
            if (amendment) {
              rememberStep(lastExtracted);
              if ("system" in amendment) {
                currentSystem = amendment.system;
                currentSystemBlocks = amendment.systemBlocks;
              }
              if (amendment[systemMessagePrefixPatch]) {
                messages = applySystemMessagePrefixPatch(
                  messages,
                  amendment[systemMessagePrefixPatch],
                );
              }
              steps--;
              step--;
              continue;
            }
            rememberStep(lastExtracted);
            const triggered = findTriggeredStopCondition(stopConditions, {
              steps,
              toolCalls: lastExtracted.toolCalls,
            });
            if (triggered) {
              stoppedBy = triggered;
              break;
            }
          }

          if (lastExtracted) {
            const suspended = suspendedApproval;
            const schema = resolved.schema;

            // Re-call the provider with corrective messages, step-guard it, and
            // accumulate the result step; returns the new candidate text. Shared
            // by validation retry and constraint regeneration.
            const repromptProvider = async (
              corrective: readonly Message[],
              writeback: import("../../safety/session-feedback-guard").CorrectiveWriteback,
            ): Promise<string> => {
              const guardedWriteback = await guardCorrectiveWriteback({
                ...writeback,
                corrective,
                guard: safetySessionFeedbackGuard(safety),
              });
              replaceLastStep(replaceResponseText(lastExtracted!, ""));
              messages = dialect.appendToolRound(
                messages,
                replaceResponseTranscriptText(
                  lastExtracted!,
                  guardedWriteback.rejectedOutput,
                ),
                [],
              );
              messages = [...messages, ...guardedWriteback.corrective];
              const providerMessages = await prepareProviderMessages(messages);
              const boundary = await prepareBoundary(
                providerMessages,
                "validation-retry",
              );
              const regenArgs = {
                ...lastCallArgs!,
                model: boundary.model,
                system:
                  boundary.resolved === resolved
                    ? currentSystem
                    : boundary.resolved.system,
                systemBlocks:
                  boundary.resolved === resolved
                    ? currentSystemBlocks
                    : boundary.resolved.systemBlocks,
                messages: providerMessages,
                settings:
                  boundary.resolved === resolved
                    ? mappedSettings
                    : dialect.mapSettings(boundary.resolved.settings),
                tools: selectedDescriptors(
                  lifecycle.descriptors,
                  boundary.activeTools,
                ),
              };
              const sealed = await sealProviderRequest(regenArgs, boundary);
              lastCallArgs = sealed.request;
              const regen = await callProvider(lastCallArgs);
              recordPrepareStepOutcome(prepareStepState, {
                usage: regen.extracted.usage,
                transportRetries: regen.extracted.transportRetries,
              });
              recordRequestRetryCount(
                sealed.receipt,
                regen.extracted.transportRetries,
              );
              lastRaw = regen.raw;
              steps++;
              const providerRegenStep = stepFactsFromResponse(regen.extracted);
              const guardedRegen = await guardSafetySessionLanguageStep(
                safety,
                providerResponseOrdinal++,
                providerRegenStep,
                schema,
              );
              lastExtracted = sameStepContent(
                providerRegenStep.content,
                guardedRegen.content,
              )
                ? regen.extracted
                : replaceResponseContent(regen.extracted, guardedRegen.content);
              rememberStep(lastExtracted);
              return lastExtracted.text;
            };

            const applyFinalText = (text: string): void => {
              if (text !== lastExtracted!.text) {
                lastExtracted = replaceResponseText(lastExtracted!, text);
                replaceLastStep(lastExtracted);
              }
            };

            if (schema) {
              const completion = createStructuredCompletion({
                safety,
                schema,
                decodeManifest,
                ...(canonicalSchema
                  ? { structuredContext: { canonicalSchema, decodeManifest } }
                  : {}),
                promptId: prompt.id ?? "unknown",
                validationRetry,
                maxSteps,
                steps: () => steps,
                messages: () => messages,
                reprompt: repromptProvider,
              });
              const initial = suspended
                ? { text: lastExtracted.text, parsed: undefined }
                : completion.buildFromText(lastExtracted.text);
              if (!suspended) applyFinalText(initial.text);
              const result = await completion.finalize(initial, { suspended });
              applyFinalText(result.text);
              acceptedCanonicalInput = result.canonicalInput;
              parsedObject = result.object;
            } else {
              // Non-structured text path: constraint regeneration shares the same
              // maxSteps budget; once exhausted, no further provider call is made.
              const textRegenerate = async (
                corrective: readonly Message[],
                writeback: import("../../safety/session-feedback-guard").CorrectiveWriteback,
              ): Promise<SafetyOutput> =>
                steps >= maxSteps
                  ? { text: lastExtracted!.text, parsed: undefined }
                  : {
                      text: await repromptProvider(corrective, writeback),
                      parsed: undefined,
                    };
              const finalOutput = await finalizeSafetySessionLanguageOutput(
                safety,
                { text: lastExtracted.text, parsed: undefined },
                textRegenerate,
                { suspended, messages },
              );
              applyFinalText(finalOutput.text);
              parsedObject = undefined;
            }
          }

          const meta: GenerationMeta = safety.stamp({
            usage: lastExtracted?.usage,
            finishReason: suspendedApproval
              ? "tool_approval_required"
              : lastExtracted?.finishReason,
            stoppedBy,
            toolCalls: lastExtracted?.toolCalls?.map((tc) => ({
              id: tc.id,
              name: tc.name,
              args: tc.args,
            })),
            responseId: lastExtracted?.responseId,
            actualModelId: lastExtracted?.actualModelId,
          });

          const resultMessages = suspendedApproval
            ? messages
            : appendAssistantResultMessage(messages, lastExtracted);

          const accumulator = createResultAccumulator();
          for (const facts of stepFacts) accumulator.addStep(facts);

          const result = accumulator.finalize({
            raw: lastRaw,
            messages: resultMessages,
            _meta: meta,
            ...(parsedObject !== undefined ? { object: parsedObject } : {}),
            ...(meta.cost !== undefined ? { cost: meta.cost } : {}),
            ...(pendingApprovals ? { pendingApprovals } : {}),
          });
          return resolved.schema &&
            !suspendedApproval &&
            acceptedCanonicalInput !== undefined
            ? attachCachedStructuredCandidate(result, acceptedCanonicalInput)
            : result;
        },
        async (result) => {
          await lifecycle.captureTurn({
            messages,
            assistantText: result.text,
            toolCalls: stepFacts.flatMap((step) => step.toolCalls ?? []),
          });
        },
      ),
    )
    .catch(async (error: unknown) => {
      await sourceSession.close();
      throw error;
    });

  try {
    return generated;
  } finally {
    await sourceSession.close();
  }

  function rememberStep(response: AdapterResponse | undefined): void {
    if (!response || !lastRequestReceipt) return;
    stepFacts.push(stepFactsFromResponse(response, lastRequestReceipt));
  }

  function replaceLastStep(response: AdapterResponse | undefined): void {
    if (!response || !lastRequestReceipt || stepFacts.length === 0) return;
    stepFacts[stepFacts.length - 1] = stepFactsFromResponse(
      response,
      lastRequestReceipt,
    );
  }
}

type PreparedCoreBoundary = ResolvedExecutionAmendment<string> & {
  readonly decision?: {
    readonly amendment?: ExecutionAmendment<string>;
    readonly resources: PreparationResources;
    readonly stepIndex: number;
    readonly reason: StepReason;
  };
};

function selectedDescriptors(
  descriptors:
    | readonly NonNullable<CallArgs<Record<string, unknown>>["tools"]>[number][]
    | undefined,
  activeTools: readonly string[] | undefined,
): CallArgs<Record<string, unknown>>["tools"] {
  if (!descriptors) return undefined;
  const selected = activeTools
    ? descriptors.filter((descriptor) => activeTools.includes(descriptor.name))
    : descriptors;
  return selected.length > 0 ? [...selected] : undefined;
}

function stepFactsFromResponse(
  response: AdapterResponse,
  request?: RequestReceipt,
): ResultStepFacts {
  return {
    ...(request ? { request } : {}),
    content: responseContent(response),
    ...(response.usage !== undefined ? { usage: response.usage } : {}),
    ...(response.toolCalls !== undefined
      ? { toolCalls: response.toolCalls }
      : {}),
    finishReason: response.finishReason,
    responseId: response.responseId,
    modelId: response.actualModelId,
    ...(response.warnings !== undefined ? { warnings: response.warnings } : {}),
    ...(response.providerMetadata !== undefined
      ? { providerMetadata: response.providerMetadata }
      : {}),
  };
}

function sameStepContent(
  left: readonly AssistantContentPart[],
  right: readonly AssistantContentPart[],
): boolean {
  return (
    left.length === right.length &&
    left.every((part, index) => part === right[index])
  );
}
