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
import type { RequestHistoryContext } from "../../request/history/source";
import type { ResolvedRepresentationPolicy } from "../../request/representation/ladder-types";
import { createRequestRepresentationEpoch } from "../../request/planner/epoch";
import type { GenerateHistorySummary } from "../../request/artifacts/lifecycle";

interface SdkRequestPlannerOptions<TModel, TRawResponse, TRawStream> {
  readonly dialect: SdkLoopDialect<TModel, TRawResponse, TRawStream>;
  readonly settings: GenerationSettings;
  readonly inputBudget?: InputBudget;
  readonly schema?: z.ZodType;
  readonly outputSchema?: JsonSchemaObject;
  readonly tools: () => CallArgs["tools"];
  readonly activeTools?: readonly string[];
  readonly extra?: Record<string, unknown>;
  readonly history?: RequestHistoryContext;
  readonly generateHistorySummary?: GenerateHistorySummary;
  readonly representations: () =>
    readonly ResolvedRepresentationPolicy[] | undefined;
  readonly prepareRequest?: (
    request: CallArgs<Record<string, unknown>>,
    selections: ReadonlyMap<string, number>,
  ) => Promise<CallArgs<Record<string, unknown>>>;
  readonly applyRepresentationSelection?: (
    selections: ReadonlyMap<string, number>,
  ) => void | Promise<void>;
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
  const representationEpoch = createRequestRepresentationEpoch();

  return async (step) => {
    const mappedSettings = options.dialect.mapSettings(
      options.settings,
      step.modelInfo,
    );
    const tools = options.tools();
    const sealed = await sealRequest({
      provider: step.modelInfo.provider || options.dialect.id,
      model: step.modelInfo.modelId,
      responseModel: step.model,
      request: {
        model: step.modelInfo.modelId,
        system: step.system,
        systemBlocks: step.systemBlocks,
        messages: [...step.messages],
        settings: mappedSettings,
        schema: options.schema,
        outputSchema: options.outputSchema,
        tools,
        extra: options.extra ?? {},
      },
      settings: options.settings,
      inputBudget: options.inputBudget,
      capacity: options.dialect.capacity
        ? () => options.dialect.capacity!(step.modelInfo)
        : undefined,
      media: options.dialect.media,
      previousRequestId,
      history: options.history,
      generateHistorySummary: options.generateHistorySummary,
      representations: options.representations(),
      representationEpoch,
      prepareRequest: options.prepareRequest,
      applyRepresentationSelection: options.applyRepresentationSelection,
    });
    previousRequestId = sealed.receipt.id;
    const originalToolNames = tools?.map((tool) => tool.name) ?? [];
    const selectedToolNames =
      sealed.request.tools?.map((tool) => tool.name) ?? [];
    const toolsChanged =
      originalToolNames.length !== selectedToolNames.length ||
      originalToolNames.some(
        (name, index) => name !== selectedToolNames[index],
      );
    const activeTools = toolsChanged
      ? (options.activeTools ?? originalToolNames).filter((name) =>
          selectedToolNames.includes(name),
        )
      : options.activeTools;
    return Object.freeze({
      model: step.model,
      modelInfo: Object.freeze({ ...step.modelInfo }),
      system: sealed.request.system,
      systemBlocks: sealed.request.systemBlocks,
      messages: sealed.request.messages,
      ...(activeTools ? { activeTools: Object.freeze([...activeTools]) } : {}),
      receipt: sealed.receipt,
    });
  };
}
