/**
 * Portable and provider-native managed-history support calls.
 *
 * @internal
 * @module
 */

import type { CallArgs } from "../types";
import type {
  CoreStepDialect,
  SdkLoopDialect,
} from "./dialect-types";
import type { GenerateHistorySummary } from "../../request/artifacts/lifecycle";
import { sealRequest } from "../../request/planner/seal";
import { preparePortableHistorySummary } from "../../request/history/prepare";
import { retainSupportRequestReceipt } from "../../request/receipt/support";

const SUMMARY_SYSTEM =
  "You are a conversation summarizer. Produce a concise summary of the canonical conversation prefix. Preserve decisions, facts, tool results, and user preferences. Do not add information.";

/** Build a summary generator for a Core-owned provider loop. */
export function coreHistorySummaryGenerator<
  TClient,
  TRawResponse,
  TRawStream,
  TExtra extends Record<string, unknown>,
>(
  dialect: CoreStepDialect<
    TClient,
    TRawResponse,
    TRawStream,
    TExtra
  >,
  call: (
    args: CallArgs<TExtra>,
  ) => Promise<{ raw: TRawResponse; extracted: { readonly text: string } }>,
): GenerateHistorySummary {
  return async (input) => {
    if (input.providerNative && dialect.compactHistory) {
      const generated = await dialect.compactHistory(
        dialect.client,
        input,
      );
      if (!generated.requestId) {
        throw new TypeError(
          `Adapter "${dialect.id}" returned an unreceipted native history summary.`,
        );
      }
      return Object.freeze({
        ...generated,
        requestIds: Object.freeze([generated.requestId]),
      });
    }
    return preparePortableHistorySummary(input, async (part) => {
      const model = modelIdentity(part.model);
      const settings = { maxTokens: 500 };
      const request: CallArgs<TExtra> = {
        model,
        system: SUMMARY_SYSTEM,
        systemBlocks: undefined,
        messages: [...part.messages],
        settings: dialect.mapSettings(settings),
        schema: undefined,
        outputSchema: undefined,
        tools: undefined,
        extra: {} as TExtra,
      };
      const sealed = await sealRequest({
        provider: dialect.id,
        model,
        request,
        settings,
        capacity: dialect.capacity,
        countTokens: dialect.countTokens
          ? (candidate) => dialect.countTokens!(dialect.client, candidate)
          : undefined,
        media: dialect.media,
      });
      const generated = await call(sealed.request);
      retainSupportRequestReceipt(sealed.receipt);
      return Object.freeze({
        summary: generated.extracted.text,
        requestId: sealed.receipt.id,
        requestIds: Object.freeze([sealed.receipt.id]),
      });
    });
  };
}

function modelIdentity(model: unknown): string {
  if (typeof model === "string") return model;
  if (model && typeof model === "object") {
    const identity = model as {
      readonly modelId?: unknown;
      readonly id?: unknown;
    };
    if (typeof identity.modelId === "string") return identity.modelId;
    if (typeof identity.id === "string") return identity.id;
  }
  return String(model);
}

/** Build a summary generator for an SDK-owned provider loop. */
export function sdkHistorySummaryGenerator<
  TModel,
  TRawResponse,
  TRawStream,
>(
  dialect: SdkLoopDialect<TModel, TRawResponse, TRawStream>,
): GenerateHistorySummary {
  return async (input) => {
    if (!dialect.compactHistory) {
      throw new TypeError(
        `Loop runtime "${dialect.id}" cannot prepare managed history summaries.`,
      );
    }
    return preparePortableHistorySummary(input, async (part) => {
      const model = dialect.describeModel(part.model as TModel);
      const settings = { maxTokens: 500 };
      const sealed = await sealRequest({
        provider: model.provider || dialect.id,
        model: model.modelId,
        responseModel: part.model,
        request: {
          model: model.modelId,
          system: SUMMARY_SYSTEM,
          systemBlocks: undefined,
          messages: [...part.messages],
          settings: dialect.mapSettings(settings, model),
          schema: undefined,
          outputSchema: undefined,
          tools: undefined,
          extra: {},
        },
        settings,
        capacity: dialect.capacity
          ? () => dialect.capacity!(model)
          : undefined,
        media: dialect.media,
      });
      const generated = await dialect.compactHistory!(part);
      retainSupportRequestReceipt(sealed.receipt);
      return Object.freeze({
        ...generated,
        requestId: generated.requestId ?? sealed.receipt.id,
        requestIds: Object.freeze([
          generated.requestId ?? sealed.receipt.id,
        ]),
      });
    });
  };
}
