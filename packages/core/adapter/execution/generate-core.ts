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
import {
  findTriggeredStopCondition,
  normalizeStopConditions,
  type StopCondition,
} from "../../generation/tool-control";
import { getHooks } from "../../runtime/runtime";
import { ValidationExhaustedError } from "../../generation/validation-retry";
import { createSafety } from "../../safety/session";
import { orchestrateGenerate } from "../../generation/orchestrate";
import type { AdapterResponse, CallArgs } from "../types";
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
  const resolved = await prompt.resolve(resolveOpts);
  const mappedSettings = dialect.mapSettings(resolved.settings);
  const lifecycle = createToolLifecycle({
    regime: "core",
    resolved,
    call: { tools: args.tools, toolMiddleware: args.toolMiddleware },
    promptId: prompt.id,
    input: args.input ?? {},
    reresolve: (skillSession) =>
      prompt.resolve(withSkillActivationInput(resolveOpts, skillSession)),
    appendToolRound: dialect.appendToolRound,
    sanitizeToolSchema: dialect.sanitizeToolSchema,
  });

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
  messages = (await lifecycle.resume(messages)).messages;

  const generated = await orchestrateGenerate(
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
    },
    async () => {
      messages = [...(await safety.guardInput({ messages })).messages];
      let lastCallArgs: CallArgs<TExtra> | undefined;

      for (let step = 0; step < maxSteps; step++) {
        steps++;
        const callArgs: CallArgs<TExtra> = {
          model: modelInfo.modelId,
          system: currentSystem,
          systemBlocks: currentSystemBlocks,
          messages,
          settings: mappedSettings,
          schema: resolved.schema,
          schemaParams,
          tools: lifecycle.descriptors ? [...lifecycle.descriptors] : undefined,
          extra: (args.extra ?? {}) as TExtra,
        };
        lastCallArgs = callArgs;

        const { raw, extracted } = await dialect.call(dialect.client, callArgs);
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
            const validText = validationResult.repairedText ?? extracted.text;
            if (validText !== extracted.text) {
              lastExtracted = { ...extracted, text: validText };
            }
            break;
          }
          if (validationRetries < maxValidationRetries && step < maxSteps - 1) {
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
          break;
        }

        if (!extracted.toolCalls || extracted.toolCalls.length === 0) continue;
        const round = await lifecycle.executeRound(extracted, messages);
        messages = round.messages;
        if (round.kind === "suspended") {
          lastExtracted = {
            ...extracted,
            finishReason: "tool_approval_required",
          };
          pendingApprovals = [round.request];
          break;
        }
        const amendment = await lifecycle.applySkillLoads(extracted.toolCalls);
        if (amendment) {
          currentSystem = amendment.system;
          currentSystemBlocks = amendment.systemBlocks;
          steps--;
          step--;
          continue;
        }
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
        const suspended =
          lastExtracted.finishReason === "tool_approval_required";
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
            messages = dialect.appendToolRound(messages, lastExtracted!, []);
            messages = [...messages, ...corrective];
            const regen = await dialect.call(dialect.client, {
              ...lastCallArgs!,
              messages,
            });
            lastRaw = regen.raw;
            lastExtracted = regen.extracted;
            steps++;
            if (resolved.schema) {
              const reVal = validateStructuredOutput(
                regen.extracted.text,
                resolved.schema,
              );
              const reText = reVal.valid
                ? (reVal.repairedText ?? regen.extracted.text)
                : regen.extracted.text;
              if (reText !== regen.extracted.text) {
                lastExtracted = { ...regen.extracted, text: reText };
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
          { suspended, messages },
        );
        if (finalOutput.text !== lastExtracted.text) {
          lastExtracted = { ...lastExtracted, text: finalOutput.text };
        }
        parsedObject = finalOutput.parsed;
      }

      const meta: TraceMeta = safety.stamp({
        usage: lastExtracted
          ? {
              inputTokens: lastExtracted.usage.inputTokens,
              outputTokens: lastExtracted.usage.outputTokens,
              totalTokens: lastExtracted.usage.totalTokens,
              cacheReadTokens: lastExtracted.usage.cacheReadTokens,
              cacheWriteTokens: lastExtracted.usage.cacheWriteTokens,
              reasoningTokens: lastExtracted.usage.reasoningTokens,
            }
          : undefined,
        finishReason: lastExtracted?.finishReason,
        stoppedBy,
        toolCalls: lastExtracted?.toolCalls?.map((tc) => ({
          id: tc.id,
          name: tc.name,
          args: tc.args,
        })),
        responseId: lastExtracted?.responseId,
        actualModelId: lastExtracted?.actualModelId,
      });

      const resultMessages =
        lastExtracted?.finishReason === "tool_approval_required"
          ? messages
          : appendAssistantResultMessage(messages, lastExtracted);

      return {
        raw: lastRaw,
        text: lastExtracted?.text ?? "",
        ...(parsedObject !== undefined ? { object: parsedObject } : {}),
        _meta: meta,
        steps,
        messages: resultMessages,
        ...(pendingApprovals ? { pendingApprovals } : {}),
      };
    },
  );

  await lifecycle.captureTurn({
    messages,
    assistantText: generated.text,
    toolCalls: generated._meta.toolCalls,
  });

  return generated;
}
