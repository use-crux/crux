/**
 * Core-owned request planning callback for SDK-managed model loops.
 *
 * @internal
 * @module
 */

import type { z } from "zod";
import type { GenerationSettings } from "../../generation/types";
import type { InputBudget } from "../../request/budget/input-budget";
import { RequestCompositionError } from "../../request/errors";
import { sealRequest } from "../../request/planner/seal";
import { createRequestId } from "../../request/receipt/receipt";
import type { ExecutorRequestStepPlanner } from "../executor-types";
import type { JsonSchemaObject } from "../structured-output";
import type { CallArgs } from "../types";
import type { SdkLoopDialect } from "./dialect-types";

interface SdkRequestPlannerOptions<TModel, TRawResponse, TRawStream> {
  readonly dialect: SdkLoopDialect<TModel, TRawResponse, TRawStream>;
  readonly settings: GenerationSettings;
  readonly inputBudget?: InputBudget;
  readonly schema?: z.ZodType;
  readonly outputSchema?: JsonSchemaObject;
  readonly tools: () => CallArgs["tools"];
  readonly extra?: Record<string, unknown>;
}

/** Fail before SDK execution when a loop cannot surface model-call boundaries. */
export function assertSdkRequestPlanning<
  TModel,
  TRawResponse,
  TRawStream,
>(
  dialect: SdkLoopDialect<TModel, TRawResponse, TRawStream>,
): void {
  if (dialect.capabilities?.requestPlanning === "per-step") return;
  const requestId = createRequestId();
  throw new RequestCompositionError(
    "INVALID_COMPOSITION",
    `Loop runtime "${dialect.id}" cannot expose semantic provider-call boundaries required for request planning.`,
    [
      {
        id: `${requestId}:sdk-step-boundary`,
        code: "SDK_STEP_BOUNDARY_UNAVAILABLE",
        message:
          "Use a loop runtime that invokes the Core request planner before every semantic provider call.",
      },
    ],
    requestId,
  );
}

/** Build the planner callback an SDK runtime invokes before every model call. */
export function createSdkRequestStepPlanner<
  TModel,
  TRawResponse,
  TRawStream,
>(
  options: SdkRequestPlannerOptions<TModel, TRawResponse, TRawStream>,
): ExecutorRequestStepPlanner<TModel> {
  let previousRequestId: string | undefined;

  return async (step) => {
    const mappedSettings = options.dialect.mapSettings(
      options.settings,
      step.modelInfo,
    );
    const sealed = await sealRequest({
      provider: step.modelInfo.provider || options.dialect.id,
      model: step.modelInfo.modelId,
      request: {
        model: step.modelInfo.modelId,
        system: step.system,
        systemBlocks: step.systemBlocks,
        messages: [...step.messages],
        settings: mappedSettings,
        schema: options.schema,
        outputSchema: options.outputSchema,
        tools: options.tools(),
        extra: options.extra ?? {},
      },
      settings: options.settings,
      inputBudget: options.inputBudget,
      capacity: options.dialect.capacity
        ? () => options.dialect.capacity!(step.modelInfo)
        : undefined,
      media: options.dialect.media,
      previousRequestId,
    });
    previousRequestId = sealed.receipt.id;
    return Object.freeze({
      model: step.model,
      modelInfo: Object.freeze({ ...step.modelInfo }),
      system: sealed.request.system,
      systemBlocks: sealed.request.systemBlocks,
      messages: sealed.request.messages,
      receipt: sealed.receipt,
    });
  };
}
