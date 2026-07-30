import type { LanguageModel, StopCondition, ToolSet } from "ai";
import type {
  ExecutorOutcome,
  ExecutorRequest,
  RequestReceipt,
  SystemMessagePrefixPatch,
} from "@use-crux/core/adapter";
import {
  systemMessagePrefixPatch,
  toJsonValue,
} from "@use-crux/core/adapter";
import type { SdkGateway } from "../gateway";
import type { SdkUsageLike } from "../meta";
import { extractCost, normalizeUsage } from "../meta";
import {
  dropTrailingAssistant,
  fromResponseMessages,
  lowerSealedAiSdkMessages,
  normalizeAiSdkMessages,
} from "../messages";
import { buildSystemArg, extractModelInfo } from "../provider-profile";
import { extractResponse } from "../result-shape";
import { mapAiSdkFinishReason } from "../normalized-outcome";
import { canonicalBase, buildBaseArgs } from "./request-args";
import { withToolCallRepair } from "./tool-call-repair";
import { decodeAssistantContentFromAiSdkParts } from "../assistant-content";
import { createStepTransformModelWrapper } from "./step-transform";
import { applyAiSdkSystemMessagePrefixPatch } from "./system-prefix-patch";
import type {
  AiSdkCallPlan,
  SdkLoopResultLike,
  SdkStepResultLike,
} from "./types";

type LoopStepFacts = NonNullable<
  Extract<
    ExecutorOutcome<SdkLoopResultLike>,
    { status: "complete" }
  >["stepFacts"]
>;

const APPROVAL_PART = "tool-approval-request";

/**
 * Plan one AI SDK `generateText()` loop and the corresponding core outcome
 * decoder.
 *
 * The plan captures mutable loop-steering state in closures because the AI
 * SDK invokes `onStepFinish`/`prepareStep` while the gateway call is running;
 * decoding then uses the final refunded-step count to project Crux's budgeted
 * step total.
 *
 * @internal
 */
export function createLoopCallPlan(
  request: ExecutorRequest<LanguageModel>,
): AiSdkCallPlan<"generateText", ExecutorOutcome<SdkLoopResultLike>> {
  const planStep = request.planStep;
  const args = buildBaseArgs(request, { includeTools: true });
  withToolCallRepair(args);
  const wrapStepModel = request.stepTransformer
    ? createStepTransformModelWrapper(request.stepTransformer)
    : undefined;

  let stopReason: string | undefined;
  let refunds = 0;
  let stepIndex = 0;
  const requestReceipts: RequestReceipt[] = [];
  let planningSystem = request.system;
  let planningSystemBlocks = request.systemBlocks;
  let overrides:
    | {
        system?: ReturnType<typeof buildSystemArg>;
        activeTools?: readonly string[];
        [systemMessagePrefixPatch]?: SystemMessagePrefixPatch;
      }
    | undefined;

  const directiveStop: StopCondition<ToolSet> = () => stopReason !== undefined;
  const explicitStop = (request.extra?.stopWhen ??
    request.settings.stopWhen) as
    | StopCondition<ToolSet>
    | StopCondition<ToolSet>[]
    | undefined;
  const budget: StopCondition<ToolSet> = ({ steps }) =>
    steps.length >= request.maxSteps + refunds;
  if (explicitStop !== undefined) {
    args.stopWhen = [
      ...(Array.isArray(explicitStop) ? explicitStop : [explicitStop]),
      directiveStop,
      budget,
    ];
  } else {
    args.stopWhen = [directiveStop, budget];
  }

  if (request.observer) {
    const observer = request.observer;
    args.onStepFinish = async (step: {
      text: string;
      toolCalls: Array<{
        toolCallId: string;
        toolName: string;
        input?: unknown;
      }>;
      toolResults: Array<{
        toolCallId: string;
        toolName: string;
        output?: unknown;
      }>;
      finishReason?: string;
      usage?: SdkUsageLike;
      content?: Array<Record<string, unknown>>;
    }) => {
      const content = step.content
        ? decodeAssistantContentFromAiSdkParts(step.content)
        : step.text
          ? ([{ type: "text", text: step.text }] as const)
          : [];
      const directive = await observer.onStepEnd({
        ...(requestReceipts[stepIndex]
          ? { request: requestReceipts[stepIndex] }
          : {}),
        index: stepIndex,
        text: step.text,
        content,
        toolCalls: step.toolCalls.map((tc) => ({
          id: tc.toolCallId,
          name: tc.toolName,
          args: tc.input,
        })),
        toolResults: step.toolResults.map((tr) => ({
          toolCallId: tr.toolCallId,
          toolName: tr.toolName,
          output: tr.output,
        })),
        finishReason: step.finishReason,
        usage: normalizeUsage(step.usage),
      });
      stepIndex++;
      if (directive.kind === "stop") {
        stopReason = directive.reason ?? "observer";
      } else if (directive.kind === "amend") {
        if (
          directive.system !== undefined ||
          directive.systemBlocks !== undefined
        ) {
          planningSystem = directive.system;
          planningSystemBlocks = directive.systemBlocks;
        }
        if (directive.refundStep) {
          refunds++;
          stepIndex--;
        }
        overrides = {
          ...(directive.system !== undefined ||
          directive.systemBlocks !== undefined
            ? {
                system: buildSystemArg(
                  directive.systemBlocks,
                  directive.system,
                  request.modelInfo,
                ),
              }
            : {}),
          ...(directive.activeTools !== undefined
            ? { activeTools: directive.activeTools }
            : {}),
          ...(directive[systemMessagePrefixPatch] !== undefined
            ? {
                [systemMessagePrefixPatch]:
                  directive[systemMessagePrefixPatch],
              }
            : {}),
        };
      }
    };
  }
  args.prepareStep = async ({
    model,
    messages,
  }: {
    model: Parameters<NonNullable<typeof wrapStepModel>>[0];
    messages: Array<{ role: string; content: unknown }>;
  }) => {
    const prefixPatch = overrides?.[systemMessagePrefixPatch];
    const patchedMessages = prefixPatch
      ? applyAiSdkSystemMessagePrefixPatch(messages, prefixPatch)
      : undefined;
    if (prefixPatch && overrides) {
      overrides = {
        ...(overrides.system !== undefined ? { system: overrides.system } : {}),
        ...(overrides.activeTools !== undefined
          ? { activeTools: overrides.activeTools }
          : {}),
      };
    }
    const stepModel = wrapStepModel ? wrapStepModel(model) : model;
    if (!planStep) {
      return {
        ...(wrapStepModel ? { model: stepModel } : {}),
        ...(overrides?.system !== undefined
          ? { system: overrides.system }
          : {}),
        ...(overrides?.activeTools !== undefined
          ? { activeTools: [...overrides.activeTools] }
          : {}),
        ...(patchedMessages !== undefined
          ? { messages: patchedMessages }
          : {}),
      };
    }
    const stepMessages = patchedMessages ?? messages;
      const normalizedMessages = normalizeAiSdkMessages(
        stepMessages as Array<{
          role: string;
          content: unknown;
        }>,
      );
      const planned = await planStep({
          model: stepModel,
          modelInfo: extractModelInfo(stepModel),
          system: planningSystem,
          systemBlocks: planningSystemBlocks,
          messages: normalizedMessages,
        });
    requestReceipts.push(planned.receipt);
    return {
      model: planned.model,
      system: buildSystemArg(
        planned.systemBlocks,
        planned.system,
        planned.modelInfo,
      ),
      ...(overrides?.activeTools !== undefined
        ? { activeTools: [...overrides.activeTools] }
        : {}),
        messages: lowerSealedAiSdkMessages(
          stepMessages as Array<{ role: string; content: unknown }>,
          normalizedMessages,
          planned.messages,
          {
            provider: planned.modelInfo.provider || "ai-sdk",
            diagnostics: request.diagnostics,
          },
        ),
    };
  };

  return {
    method: "generateText",
    args: args as Parameters<SdkGateway["generateText"]>[0],
    decode(raw): ExecutorOutcome<SdkLoopResultLike> {
      return decodeLoopResult(
        request,
        raw as SdkLoopResultLike,
        refunds,
        requestReceipts,
      );
    },
  };
}

function decodeLoopResult(
  request: ExecutorRequest<LanguageModel>,
  result: SdkLoopResultLike,
  refunds: number,
  requestReceipts: readonly RequestReceipt[],
): ExecutorOutcome<SdkLoopResultLike> {
  const base = canonicalBase(request);
  const sdkSteps = result.steps?.length ?? 1;
  const budgetSteps = Math.max(1, sdkSteps - refunds);
  const approvalParts = (result.content ?? []).filter(
    (part) => part.type === APPROVAL_PART,
  );

  if (approvalParts.length > 0) {
    const converted = fromResponseMessages(result.response?.messages ?? []);
    return {
      status: "suspended",
      reason: "tool-approval",
      pendingApprovals: approvalParts.map((part) => ({
        toolCallId: part.toolCall?.toolCallId ?? "",
        toolName: part.toolCall?.toolName ?? "",
        input: toJsonValue(part.toolCall?.input),
      })),
      assistantResponse: extractResponse(result),
      messages: [...base, ...dropTrailingAssistant(converted)],
      steps: budgetSteps,
    };
  }

  return {
    status: "complete",
    raw: result,
    response: extractResponse(result),
    messages: [
      ...base,
      ...fromResponseMessages(result.response?.messages ?? []),
    ],
    steps: budgetSteps,
    stepFacts: sdkStepFacts(result.steps, requestReceipts),
    meta: {
      costUsd: extractCost(result.providerMetadata),
      providerMetadata: result.providerMetadata,
    },
  };
}

function sdkStepFacts(
  steps: ReadonlyArray<SdkStepResultLike> | undefined,
  requestReceipts: readonly RequestReceipt[],
): LoopStepFacts | undefined {
  if (!steps || steps.length === 0) return undefined;
  const facts = steps.map((step, index) => {
    const usage = normalizeUsage(step.usage);
    const content = step.content
      ? decodeAssistantContentFromAiSdkParts(step.content)
      : undefined;
    return {
      ...(requestReceipts[index] ? { request: requestReceipts[index] } : {}),
      content:
        content !== undefined && (content.length > 0 || !step.text)
          ? content
          : step.text
            ? ([{ type: "text", text: step.text }] as const)
            : [],
      ...(usage !== undefined ? { usage } : {}),
      ...(step.toolCalls && step.toolCalls.length > 0
        ? {
            toolCalls: step.toolCalls.map((call) => ({
              id: call.toolCallId,
              name: call.toolName,
              args: call.input ?? call.args,
            })),
          }
        : {}),
      finishReason: mapAiSdkFinishReason(step.finishReason),
      responseId: step.response?.id,
      modelId: step.response?.modelId,
    };
  });
  return facts.some(hasStepFact) ? facts : undefined;
}

function hasStepFact(fact: LoopStepFacts[number]): boolean {
  return (
    fact.content.some((part) => part.type !== "text" || part.text !== "") ||
    fact.usage !== undefined ||
    fact.finishReason !== undefined ||
    fact.responseId !== undefined ||
    fact.modelId !== undefined
  );
}
