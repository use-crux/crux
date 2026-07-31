/**
 * AI SDK structured-output single-attempt mechanics.
 *
 * Core owns structured-output policy for SDK-loop adapters: validation retry,
 * corrective feedback, exhaustion errors, safety, interception, and result
 * shaping. This module owns the one AI SDK-specific operation core cannot
 * perform: exactly one `generateObject()` attempt with provider schema quirks,
 * cheap JSON repair, and SDK validation errors translated into the
 * `StructuredAttempt` contract.
 *
 * @internal
 * @module
 */

import type { LanguageModel } from "ai";
import type { GenerateObjectFn, Message } from "@use-crux/core";
import type {
  JsonSchemaObject,
  StructuredAttempt,
  StructuredRequest,
} from "@use-crux/core/adapter";
import {
  compileStructuredOutput,
  CruxUnsupportedStructuredOutputError,
  decodeStructuredValue,
} from "@use-crux/core/adapter";
import { resolveModel } from "@use-crux/core/routing";
import type { SdkGateway } from "./gateway";
import type { SdkLoopResultLike } from "./sdk-codec";
import { createAiSdkCodec } from "./sdk-codec";
import {
  aiSdkStructuredCapabilities,
  extractModelInfo,
} from "./provider-profile";

/** The gateway surface required for one AI SDK structured-output attempt. */
export type StructuredGateway = Pick<SdkGateway, "generateText">;

type StructuredArgs = Parameters<StructuredGateway["generateText"]>[0];

type GenerateObjectOptions<T> = {
  readonly model: unknown;
  readonly system?: string;
  readonly schema: import("zod").ZodType<T>;
  readonly temperature?: number;
  readonly topP?: number;
} & (
  | { readonly prompt: string; readonly messages?: never }
  | { readonly messages: readonly Message[]; readonly prompt?: never }
);

interface StructuredObjectResult<T> {
  readonly object: T;
}

interface StructuredFallbackTryOptions {
  readonly signal?: AbortSignal;
}

/**
 * Perform exactly one AI SDK `generateObject()` attempt.
 *
 * Validation and parse failures are returned as `status: 'invalid'` so core
 * can decide whether and how to retry. Provider, transport, and other runtime
 * failures continue to throw unchanged.
 */
export async function attemptStructuredGeneration(
  gateway: StructuredGateway,
  request: StructuredRequest<LanguageModel>,
): Promise<StructuredAttempt<SdkLoopResultLike>> {
  const call = await createAiSdkCodec().structured(request);

  try {
    return call.decode(
      await gateway.generateText(call.args as StructuredArgs),
    );
  } catch (error) {
    const invalid = await call.decodeError(error);
    if (invalid) return invalid;
    throw error;
  }
}

/**
 * Create the standalone `GenerateObjectFn` used by Crux primitives such as
 * judges and extraction helpers.
 *
 * The helper shares the same schema sanitation and repair mechanics as prompt
 * structured generation, while keeping the public `GenerateObjectFn` shape:
 * callers provide a model for each call and receive `{ object }`, not a
 * `StructuredAttempt`.
 */
export function createStructuredGenerateObjectFn(
  gateway: StructuredGateway,
): GenerateObjectFn {
  return async <T>(
    options: GenerateObjectOptions<T>,
  ): Promise<StructuredObjectResult<T>> => {
    const run = async (
      model: LanguageModel,
      attemptOptions: StructuredFallbackTryOptions = {},
    ): Promise<StructuredObjectResult<T>> => {
      // Core owns compilation and the authored parse even for this standalone
      // helper: compile a wire schema the SDK validates structurally, then
      // decode + authored-parse the wire value here.
      const capabilities = aiSdkStructuredCapabilities(extractModelInfo(model));
      if (!capabilities) {
        throw new CruxUnsupportedStructuredOutputError(
          "ai-sdk",
          `the selected model has no verified structured-output capability profile`,
        );
      }
      const plan = compileStructuredOutput(options.schema, capabilities);
      const attempt = await attemptStructuredGeneration(
        gateway,
        requestFromGenerateObjectOptions(
          model,
          options,
          plan.outputSchema,
          attemptOptions,
        ),
      );
      if (attempt.status === "invalid") throw attempt.error;
      const decoded = decodeStructuredValue(
        attempt.wireValue,
        plan.decodeManifest,
      );
      return { object: options.schema.parse(decoded) as T };
    };

    return resolveModel<LanguageModel, StructuredObjectResult<T>>(
      options.model as LanguageModel,
      options.messages === undefined
        ? { prompt: options.prompt }
        : { messages: options.messages },
      run,
      modelLabel,
      { mode: "generate", preserveRawResult: true },
    );
  };
}

function requestFromGenerateObjectOptions<T>(
  model: LanguageModel,
  options: GenerateObjectOptions<T>,
  outputSchema: JsonSchemaObject,
  attemptOptions: StructuredFallbackTryOptions = {},
): StructuredRequest<LanguageModel> {
  return {
    model,
    modelInfo: extractModelInfo(model),
    system: options.system,
    systemBlocks: undefined,
    prompt: options.prompt,
    messages: options.messages,
    settings: {
      ...(options.temperature === undefined
        ? {}
        : { temperature: options.temperature }),
      ...(options.topP === undefined ? {} : { topP: options.topP }),
    },
    tools: undefined,
    activeTools: undefined,
    maxSteps: 1,
    observer: undefined,
    abortSignal: attemptOptions.signal,
    extra: undefined,
    schema: options.schema,
    outputSchema,
  };
}

function modelLabel(model: LanguageModel): string {
  const info = extractModelInfo(model);
  return info.modelId || info.provider;
}
