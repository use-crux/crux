/**
 * Core-owned request planning callback for SDK-managed model loops.
 *
 * @internal
 * @module
 */

import type { z } from "zod";
import type { InputBudget } from "../../request/budget/input-budget";
import { RequestCompositionError } from "../../request/errors";
import { sealRequest } from "../../request/planner/seal";
import { createRequestId } from "../../request/receipt/receipt";
import type {
  ExecutorRequestStepInput,
  ExecutorRequestStepPlanner,
} from "../executor-types";
import type { JsonSchemaObject } from "../structured-output";
import type { CallArgs } from "../types";
import type { SdkLoopDialect } from "./dialect-types";
import type { RequestHistoryContext } from "../../request/history/source";
import { createRequestRepresentationEpoch } from "../../request/planner/epoch";
import type { GenerateHistorySummary } from "../../request/artifacts/lifecycle";
import {
  createPrepareStepState,
  recordPrepareStepOutcome,
  runPrepareStep,
  type PrepareStep,
} from "../../request/prepare/step";
import { resolveExecutionAmendment } from "../../request/prepare/amendment";
import type { AnyPrompt } from "../../prompt/prompt-types";
import type { ResolvedPrompt } from "../../resolver/types";
import {
  createPreparationResources,
  preparationResourceReads,
} from "../../request/prepare/resources";
import { commitPreparationDecision } from "../../request/prepare/journal";

interface SdkRequestPlannerOptions<TModel, TRawResponse, TRawStream> {
  readonly dialect: SdkLoopDialect<TModel, TRawResponse, TRawStream>;
  readonly inputBudget?: InputBudget;
  readonly schema?: z.ZodType;
  readonly outputSchema?: JsonSchemaObject;
  readonly tools: () => CallArgs["tools"];
  readonly activeTools: () => readonly string[] | undefined;
  readonly extra?: Record<string, unknown>;
  readonly history?: RequestHistoryContext;
  readonly generateHistorySummary?: GenerateHistorySummary;
  readonly prepareRequest?: (
    request: CallArgs<Record<string, unknown>>,
    selections: ReadonlyMap<string, number>,
  ) => Promise<CallArgs<Record<string, unknown>>>;
  readonly applyRepresentationSelection?: (
    selections: ReadonlyMap<string, number>,
  ) => void | Promise<void>;
  readonly prepareStep?: PrepareStep<TModel>;
  readonly requestInput: Readonly<Record<string, unknown>>;
  readonly signal?: AbortSignal;
  readonly prompt: AnyPrompt;
  readonly resolveOptions: () => Parameters<AnyPrompt["resolve"]>[0];
  readonly resolved: () => ResolvedPrompt;
  readonly rearm: (resolved: ResolvedPrompt) => Promise<void>;
  readonly configuredActiveTools?: readonly string[];
}

/** Fail before SDK execution when a loop cannot surface model-call boundaries. */
export function assertSdkRequestPlanning<TModel, TRawResponse, TRawStream>(
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
export function createSdkRequestStepPlanner<TModel, TRawResponse, TRawStream>(
  options: SdkRequestPlannerOptions<TModel, TRawResponse, TRawStream>,
): ExecutorRequestStepPlanner<TModel> & {
  prime(input: ExecutorRequestStepInput<TModel>): Promise<void>;
} {
  let previousRequestId: string | undefined;
  let previousReceipt:
    | import("../../request/receipt/receipt").RequestReceipt
    | undefined;
  const representationEpoch = createRequestRepresentationEpoch();
  const prepareStepState = createPrepareStepState();
  let primed: Awaited<ReturnType<typeof prepareBoundary>> | undefined;

  async function prepareBoundary(step: ExecutorRequestStepInput<TModel>) {
    const resources = createPreparationResources({
      entries: options.prompt.contexts,
      requestInput: options.requestInput,
      promptId: options.prompt.id,
    });
    const reason = previousRequestId
      ? ("tool-result" as const)
      : ("initial" as const);
    const amendment = await runPrepareStep({
      callback: options.prepareStep,
      state: prepareStepState,
      requestInput: options.requestInput,
      reason,
      previousReceipt,
      messages: step.messages,
      resources,
      signal: options.signal,
    });
    const baseline = options.resolved();
    const boundary = await resolveExecutionAmendment({
      prompt: options.prompt,
      resolveOptions: options.resolveOptions(),
      baseline,
      amendment,
      model: step.model,
      inputBudget: options.inputBudget,
      baselineActiveTools: options.configuredActiveTools,
      resources,
    });
    await options.rearm(boundary.resolved);
    const boundaryModelInfo = options.dialect.describeModel(boundary.model);
    return {
      amendment,
      baseline,
      boundary,
      boundaryModelInfo,
      reason,
      resources,
      stepIndex: prepareStepState.index - 1,
    };
  }

  const planner: ExecutorRequestStepPlanner<TModel> = async (step) => {
    if (step.previousCall) {
      recordPrepareStepOutcome(prepareStepState, step.previousCall);
    }
    const prepared = options.prepareStep
      ? primed ?? (await prepareBoundary(step))
      : {
          amendment: undefined,
          baseline: options.resolved(),
          boundary: {
            resolved: options.resolved(),
            model: step.model,
            inputBudget: options.inputBudget,
            activeTools: options.configuredActiveTools,
          },
          boundaryModelInfo: step.modelInfo,
          reason: previousRequestId
            ? ("tool-result" as const)
            : ("initial" as const),
          resources: undefined,
          stepIndex: -1,
        };
    primed = undefined;
    const {
      amendment,
      baseline,
      boundary,
      boundaryModelInfo,
      reason,
      resources,
      stepIndex,
    } = prepared;
    const mappedSettings = options.dialect.mapSettings(
      boundary.resolved.settings,
      boundaryModelInfo,
    );
    const tools = options.tools();
    const sealed = await sealRequest({
      provider: boundaryModelInfo.provider || options.dialect.id,
      model: boundaryModelInfo.modelId,
      responseModel: boundary.model,
      request: {
        model: boundaryModelInfo.modelId,
        system:
          boundary.resolved === baseline
            ? step.system
            : boundary.resolved.system,
        systemBlocks:
          boundary.resolved === baseline
            ? step.systemBlocks
            : boundary.resolved.systemBlocks,
        messages: [...step.messages],
        settings: mappedSettings,
        schema: options.schema,
        outputSchema: options.outputSchema,
        tools,
        extra: options.extra ?? {},
      },
      settings: boundary.resolved.settings,
      inputBudget: boundary.inputBudget,
      capacity: options.dialect.capacity
        ? () => options.dialect.capacity!(boundaryModelInfo)
        : undefined,
      media: options.dialect.media,
      previousRequestId,
      history: options.history,
      generateHistorySummary: options.generateHistorySummary,
      representations: boundary.resolved.representations,
      metadata: boundary.resolved.metadata,
      representationEpoch,
      prepareRequest: options.prepareRequest,
      applyRepresentationSelection: options.applyRepresentationSelection,
    });
    if (options.prepareStep) await options.rearm(boundary.resolved);
    if (options.prepareStep && resources) {
      commitPreparationDecision({
        receipt: sealed.receipt,
        requestId: sealed.receipt.id,
        stepIndex,
        reason,
        amendment,
        resources: preparationResourceReads(resources),
      });
    }
    previousRequestId = sealed.receipt.id;
    previousReceipt = sealed.receipt;
    const originalToolNames = tools?.map((tool) => tool.name) ?? [];
    const selectedToolNames =
      sealed.request.tools?.map((tool) => tool.name) ?? [];
    const toolsChanged =
      originalToolNames.length !== selectedToolNames.length ||
      originalToolNames.some(
        (name, index) => name !== selectedToolNames[index],
      );
    const configuredActiveTools = boundary.activeTools ?? options.activeTools();
    const activeTools = toolsChanged
      ? (configuredActiveTools ?? originalToolNames).filter((name) =>
          selectedToolNames.includes(name),
        )
      : configuredActiveTools;
    return Object.freeze({
      model: boundary.model,
      modelInfo: Object.freeze({ ...boundaryModelInfo }),
      system: sealed.request.system,
      systemBlocks: sealed.request.systemBlocks,
      messages: sealed.request.messages,
      ...(activeTools ? { activeTools: Object.freeze([...activeTools]) } : {}),
      receipt: sealed.receipt,
    });
  };
  return Object.assign(planner, {
    async prime(step: ExecutorRequestStepInput<TModel>): Promise<void> {
      if (!options.prepareStep || primed) return;
      primed = await prepareBoundary(step);
    },
  });
}
