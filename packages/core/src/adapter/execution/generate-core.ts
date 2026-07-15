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

import type { TraceMeta } from "../../generation/types";
import type { Message } from "../../generation/messages";
import {
  findTriggeredStopCondition,
  normalizeStopConditions,
  type StopCondition,
} from "../../generation/tool-control";
import { getHooks } from "../../runtime/runtime";
import { ValidationExhaustedError } from "../../generation/validation-retry";
import { createSafety } from "../../safety/session";
import { orchestrateGenerate } from "../../generation/orchestrate";
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
import {
  formatValidationFeedback,
  validateStructuredOutput,
} from "../policy/validation-retry";
import { createToolLifecycle } from "../tool/session";
import type { ApprovalRequestInfo } from "../tool/approval";
import type {
  AdapterExecutionGenerateArgs,
  AdapterExecutionGenerateResult,
  CoreStepDialect,
} from "./types";
import { appendAssistantResultMessage, initialCoreMessages } from "./messages";
import {
  buildResolveOpts,
  DEFAULT_MAX_STEPS,
  withSkillActivationInput,
} from "./shared";
import { materializeToolSources } from "./tool-sources";
import { replaceResponseText } from "./response-text";

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
): Promise<AdapterExecutionGenerateResult<TRawResponse>> {
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
  let schemaParams: Record<string, unknown> | undefined;
  if (resolved.schema && dialect.wrapOutputSchema) {
    schemaParams = dialect.wrapOutputSchema(resolved.schema);
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
  const stepFacts: ResultStepFacts[] = [];
  const validationRetry = args.validationRetry;
  const maxValidationRetries = validationRetry?.maxRetries ?? 0;
  let validationRetries = 0;
  const retryId = validationRetry
    ? `vr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    : "";
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
    traceId: retryId || undefined,
    systemPrompt: resolved.system,
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
  messages = [...(await safety.guardInput({ messages })).messages];
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
      reresolve: (skillSession) =>
        prompt.resolve(withSkillActivationInput(resolveOpts, skillSession)),
      appendToolRound: dialect.appendToolRound,
      sanitizeToolSchema: dialect.sanitizeToolSchema,
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
      orchestrateGenerate(
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
            schemaParams,
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
              schemaParams,
              tools: lifecycle.descriptors
                ? [...lifecycle.descriptors]
                : undefined,
              extra: (args.extra ?? {}) as TExtra,
            };
            lastCallArgs = callArgs;

            const { raw, extracted } = await callProvider(callArgs);
            lastRaw = raw;
            lastExtracted = extracted;

            if (extracted.toolCalls && extracted.toolCalls.length > 0) {
              // Tool calls are handled below after validation-only exits.
            } else if (resolved.schema && validationRetry) {
              const validationResult = validateStructuredOutput(
                extracted.text,
                resolved.schema,
              );
              if (validationResult.valid) {
                const validText =
                  validationResult.repairedText ?? extracted.text;
                if (validText !== extracted.text) {
                  lastExtracted = replaceResponseText(extracted, validText);
                }
                rememberStep(lastExtracted);
                break;
              }
              if (
                validationRetries < maxValidationRetries &&
                step < maxSteps - 1
              ) {
                validationRetries++;
                validationRetry.onRetry?.(
                  validationRetries,
                  validationResult.error!,
                );
                messages = dialect.appendToolRound(messages, extracted, []);
                messages = [
                  ...messages,
                  {
                    role: "user" as const,
                    content: formatValidationFeedback(
                      extracted.text,
                      validationResult.error!,
                    ),
                  },
                ];
                rememberStep(replaceResponseText(lastExtracted, ""));
                continue;
              }
              validationRetry.onExhausted?.(
                validationRetries,
                validationResult.error!,
              );
              throw new ValidationExhaustedError({
                lastRawOutput: extracted.text,
                zodErrors: validationResult.error!,
                attempts: validationRetries,
                maxAttempts: maxValidationRetries,
                promptId: prompt.id ?? "unknown",
              });
            } else {
              rememberStep(lastExtracted);
              break;
            }

            if (!extracted.toolCalls || extracted.toolCalls.length === 0)
              continue;
            const round = await lifecycle.executeRound(extracted, messages);
            messages = round.messages;
            if (round.kind === "suspended") {
              // Suspension is tracked separately; the provider-normalized finish
              // reason on the tool-call turn (e.g. "tool-calls") stays truthful.
              suspendedApproval = true;
              lastExtracted = extracted;
              pendingApprovals = [round.request];
              rememberStep(lastExtracted);
              break;
            }
            const amendment = await lifecycle.applySkillLoads(
              extracted.toolCalls,
            );
            if (amendment) {
              currentSystem = amendment.system;
              currentSystemBlocks = amendment.systemBlocks;
              steps--;
              step--;
              continue;
            }
            rememberStep(lastExtracted);
            const triggered = findTriggeredStopCondition(stopConditions, {
              steps,
              toolCalls: extracted.toolCalls,
            });
            if (triggered) {
              stoppedBy = triggered;
              break;
            }
          }

          if (lastExtracted) {
            const suspended = suspendedApproval;
            let parsed: unknown;
            if (resolved.schema && !suspended) {
              try {
                parsed = JSON.parse(lastExtracted.text);
              } catch {
                parsed = undefined;
              }
            }
            const finalOutput = await safety.finalizeOutput(
              { text: lastExtracted.text, parsed },
              async (corrective) => {
                replaceLastStep(replaceResponseText(lastExtracted!, ""));
                messages = dialect.appendToolRound(
                  messages,
                  lastExtracted!,
                  [],
                );
                messages = [...messages, ...corrective];
                const providerMessages =
                  await prepareProviderMessages(messages);
                const regen = await callProvider({
                  ...lastCallArgs!,
                  messages: providerMessages,
                });
                lastRaw = regen.raw;
                lastExtracted = regen.extracted;
                steps++;
                rememberStep(lastExtracted);
                if (resolved.schema) {
                  const reVal = validateStructuredOutput(
                    regen.extracted.text,
                    resolved.schema,
                  );
                  const reText = reVal.valid
                    ? (reVal.repairedText ?? regen.extracted.text)
                    : regen.extracted.text;
                  if (reText !== regen.extracted.text) {
                    lastExtracted = replaceResponseText(
                      regen.extracted,
                      reText,
                    );
                    replaceLastStep(lastExtracted);
                  }
                  let reParsed: unknown;
                  try {
                    reParsed = JSON.parse(reText);
                  } catch {
                    reParsed = undefined;
                  }
                  return { text: reText, parsed: reParsed };
                }
                return { text: regen.extracted.text, parsed: undefined };
              },
              { suspended, messages, schema: resolved.schema },
            );
            if (finalOutput.text !== lastExtracted.text) {
              lastExtracted = replaceResponseText(
                lastExtracted,
                finalOutput.text,
              );
              replaceLastStep(lastExtracted);
            }
            parsedObject = finalOutput.parsed;
          }

          const meta: TraceMeta = safety.stamp({
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
      ),
    )
    .catch(async (error: unknown) => {
      await sourceSession.close();
      throw error;
    });

  try {
    await lifecycle.captureTurn({
      messages,
      assistantText: generated.text,
      toolCalls: stepFacts.flatMap((step) => step.toolCalls ?? []),
    });
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
