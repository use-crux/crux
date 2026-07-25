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
  safetySessionModelIngressGuard,
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
import { appendAssistantResultMessage, initialCoreMessageState } from "./messages";
import {
  buildResolveOpts,
  DEFAULT_MAX_STEPS,
  withSkillActivationInput,
} from "./shared";
import { materializeToolSources } from "./tool-sources";
import { replaceResponseContent, replaceResponseText } from "./response-text";
import { createSkillIngressAmendmentGuard } from "./skill-ingress-amendment";
import {
  applySystemMessagePrefixPatch,
  systemMessagePrefixPatch,
} from "./system-prefix-patch";

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
    tokenBudget: args.tokenBudget,
    settings: args.settings,
  });
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
  let pendingApprovals: readonly ApprovalRequestInfo[] | undefined;
  let stoppedBy: StopCondition | undefined;
  let steps = 0;
  let providerResponseOrdinal = 0;
  const stepFacts: ResultStepFacts[] = [];
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
  const guardedInput = await guardSafetySessionResolvedInput(safety, resolved, {
    messages,
    system: currentSystem,
  }, {
    resolvedMessages:
      initialMessages.source === "resolved-messages" ? "selected" : "discarded",
  });
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
      reresolve: (skillSession) =>
        prompt.resolve(withSkillActivationInput(resolveOpts, skillSession)),
      guardSkillAmendment,
      appendToolRound: dialect.appendToolRound,
      sanitizeToolSchema: dialect.sanitizeToolSchema,
      ...(dialect.structuredOutput
        ? { structuredOutputCapabilities: dialect.structuredOutput.accepts }
        : {}),
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

  const generated = await sourceSession
    .withContext(() =>
      orchestrateGenerateWithCompletion(
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
        async () => {
          let lastCallArgs: CallArgs<TExtra> | undefined;
          let suspendedApproval = false;

          for (let step = 0; step < maxSteps; step++) {
            steps++;
            const providerMessages = await prepareProviderMessages(messages);
            emitInputTokenEstimate({
              messages: providerMessages,
              provider: modelInfo.provider,
              model: modelInfo.modelId,
              media: dialect.media,
              tokenBudget: args.tokenBudget,
            });
            const callArgs: CallArgs<TExtra> = {
              model: modelInfo.modelId,
              system: currentSystem,
              systemBlocks: currentSystemBlocks,
              messages: providerMessages,
              settings: mappedSettings,
              schema: resolved.schema,
              outputSchema,
              tools: lifecycle.descriptors
                ? [...lifecycle.descriptors]
                : undefined,
              extra: (args.extra ?? {}) as TExtra,
            };
            lastCallArgs = callArgs;

            const { raw, extracted } = await callProvider(callArgs);
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
            ): Promise<string> => {
              replaceLastStep(replaceResponseText(lastExtracted!, ""));
              messages = dialect.appendToolRound(messages, lastExtracted!, []);
              messages = [...messages, ...corrective];
              const providerMessages = await prepareProviderMessages(messages);
              const regen = await callProvider({
                ...lastCallArgs!,
                messages: providerMessages,
              });
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
              parsedObject = result.object;
            } else {
              // Non-structured text path: constraint regeneration shares the same
              // maxSteps budget; once exhausted, no further provider call is made.
              const textRegenerate = async (
                corrective: readonly Message[],
              ): Promise<SafetyOutput> =>
                steps >= maxSteps
                  ? { text: lastExtracted!.text, parsed: undefined }
                  : {
                      text: await repromptProvider(corrective),
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

          return accumulator.finalize({
            raw: lastRaw,
            messages: resultMessages,
            _meta: meta,
            ...(parsedObject !== undefined ? { object: parsedObject } : {}),
            ...(meta.cost !== undefined ? { cost: meta.cost } : {}),
            ...(pendingApprovals ? { pendingApprovals } : {}),
          });
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
    if (!response) return;
    stepFacts.push(stepFactsFromResponse(response));
  }

  function replaceLastStep(response: AdapterResponse | undefined): void {
    if (!response || stepFacts.length === 0) return;
    stepFacts[stepFacts.length - 1] = stepFactsFromResponse(response);
  }
}

function stepFactsFromResponse(response: AdapterResponse): ResultStepFacts {
  return {
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
