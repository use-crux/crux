/**
 * Canonical envelope helpers for SDK-loop execution.
 *
 * Loop-owned SDKs report a complete run back to core. This module adapts that
 * run summary into the same public envelope used by single-turn adapters.
 *
 * @internal
 * @module
 */

import type { GenerationMeta } from "../../generation/types";
import type { Message } from "../../generation/messages";
import type { AdapterResponse } from "../types";
import { responseContent } from "../assistant-output";
import type { ExecutorStep } from "../executor-types";
import type { ApprovalRequestInfo } from "../tool/approval";
import {
  createResultAccumulator,
  type ResultStepFacts,
} from "../result-accumulator";
import type { AdapterExecutionGenerateResultWithoutRunId } from "./types";
import type { RequestReceipt } from "../../request/receipt/receipt";

/** Convert an observed SDK-loop step into accumulator facts. */
export function sdkStepFacts(step: ExecutorStep): ResultStepFacts {
  return {
    ...(step.request !== undefined ? { request: step.request } : {}),
    content: step.content ?? [{ type: "text", text: step.text }],
    ...(step.usage !== undefined ? { usage: step.usage } : {}),
    ...(step.toolCalls.length > 0 ? { toolCalls: [...step.toolCalls] } : {}),
    finishReason: step.finishReason,
    responseId: undefined,
    modelId: undefined,
  };
}

/** Convert the final SDK response into accumulator facts. */
export function sdkResponseFacts(
  response: AdapterResponse,
  text: string = response.text,
): ResultStepFacts {
  return {
    content:
      text === response.text
        ? responseContent(response)
        : [{ type: "text", text }],
    ...(response.usage !== undefined ? { usage: response.usage } : {}),
    ...(response.toolCalls !== undefined ? { toolCalls: response.toolCalls } : {}),
    finishReason: response.finishReason,
    responseId: response.responseId,
    modelId: response.actualModelId,
    ...(response.warnings !== undefined ? { warnings: response.warnings } : {}),
    ...(response.providerMetadata !== undefined
      ? { providerMetadata: response.providerMetadata }
      : {}),
    ...(response.transportRetries !== undefined
      ? { transportRetries: response.transportRetries }
      : {}),
  };
}

/** Finalize an SDK-loop result through the canonical accumulator. */
export function finalizeSdkResultEnvelope<TRawResponse>(args: {
  readonly raw: TRawResponse | undefined;
  readonly response: AdapterResponse;
  readonly text: string;
  readonly object?: unknown;
  readonly _meta: GenerationMeta;
  readonly messages: Message[];
  readonly pendingApprovals?: readonly ApprovalRequestInfo[];
  readonly stepFacts?: readonly ResultStepFacts[];
  readonly finalStepMode?: "replace" | "append" | "preserve";
  readonly request?: RequestReceipt;
}): AdapterExecutionGenerateResultWithoutRunId<TRawResponse> {
  const facts = [...(args.stepFacts ?? [])];
  const finalFacts = {
    ...sdkResponseFacts(args.response, args.text),
    ...(args.request !== undefined ? { request: args.request } : {}),
  };
  if (facts.length === 0 || args.finalStepMode === "append") {
    facts.push(finalFacts);
  } else if (args.finalStepMode !== "preserve") {
    facts[facts.length - 1] = finalFacts;
  }

  const accumulator = createResultAccumulator();
  for (const fact of facts) accumulator.addStep(fact);

  return accumulator.finalize({
    raw: args.raw,
    messages: args.messages,
    _meta: args._meta,
    ...(args.object !== undefined ? { object: args.object } : {}),
    ...(args._meta.cost !== undefined ? { cost: args._meta.cost } : {}),
    ...(args.pendingApprovals
      ? { pendingApprovals: args.pendingApprovals }
      : {}),
  }) as AdapterExecutionGenerateResultWithoutRunId<TRawResponse>;
}
