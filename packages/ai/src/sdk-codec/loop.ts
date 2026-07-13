import type { LanguageModel, StopCondition, ToolSet } from "ai";
import type { ExecutorOutcome, ExecutorRequest } from "@use-crux/core/adapter";
import { toJsonValue } from "@use-crux/core/adapter";
import type { SdkGateway } from "../gateway";
import type { SdkUsageLike } from "../meta";
import { extractCost, normalizeUsage } from "../meta";
import { dropTrailingAssistant, fromResponseMessages } from "../messages";
import { buildSystemArg } from "../provider-profile";
import { extractResponse } from "../result-shape";
import { mapAiSdkFinishReason } from "../normalized-outcome";
import { canonicalBase, buildBaseArgs } from "./request-args";
import { withToolCallRepair } from "./tool-call-repair";
import { decodeAssistantContentFromAiSdkParts } from "../assistant-content";
import type {
  AiSdkCallPlan,
  SdkLoopResultLike,
  SdkStepResultLike,
} from "./types";

type LoopStepFacts = NonNullable<
  Extract<ExecutorOutcome<SdkLoopResultLike>, { status: "complete" }>["stepFacts"]
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
  const args = buildBaseArgs(request, { includeTools: true });
  withToolCallRepair(args);

  let stopReason: string | undefined;
  let refunds = 0;
  let stepIndex = 0;
  let overrides:
    | {
        system?: ReturnType<typeof buildSystemArg>;
        activeTools?: readonly string[];
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
    }) => {
      const directive = await observer.onStepEnd({
        index: stepIndex,
        text: step.text,
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
        };
      }
    };
    args.prepareStep = () =>
      overrides
        ? {
            ...(overrides.system !== undefined
              ? { system: overrides.system }
              : {}),
            ...(overrides.activeTools !== undefined
              ? { activeTools: [...overrides.activeTools] }
              : {}),
          }
        : {};
  }

  return {
    method: "generateText",
    args: args as Parameters<SdkGateway["generateText"]>[0],
    decode(raw): ExecutorOutcome<SdkLoopResultLike> {
      return decodeLoopResult(request, raw as SdkLoopResultLike, refunds);
    },
  };
}

function decodeLoopResult(
  request: ExecutorRequest<LanguageModel>,
  result: SdkLoopResultLike,
  refunds: number,
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
    stepFacts: sdkStepFacts(result.steps),
    meta: {
      costUsd: extractCost(result.providerMetadata),
      providerMetadata: result.providerMetadata,
    },
  };
}

function sdkStepFacts(
  steps: ReadonlyArray<SdkStepResultLike> | undefined,
): LoopStepFacts | undefined {
  if (!steps || steps.length === 0) return undefined;
  const facts = steps.map((step) => {
    const usage = normalizeUsage(step.usage);
    const content = step.content
      ? decodeAssistantContentFromAiSdkParts(step.content)
      : undefined;
    return {
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
    fact.content.some(
      (part) => part.type !== "text" || part.text !== "",
    ) ||
    fact.usage !== undefined ||
    fact.finishReason !== undefined ||
    fact.responseId !== undefined ||
    fact.modelId !== undefined
  );
}
