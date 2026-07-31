/**
 * Compile lightweight generation helpers from a native chat profile.
 *
 * @module
 */

import type { z } from "zod";
import type { GenerateObjectFn, GenerateTextFn } from "../../generation/support-types";
import type { Message } from "../../generation/messages";
import {
  compileStructuredOutput,
  CruxUnsupportedStructuredOutputError,
  decodeStructuredValue,
} from "../structured-output";
import type { JsonSchemaObject } from "../structured-output";
import type { NativeChatHelpers } from "./helper-types";
import { requestArgsFor, responseFor } from "./request-response";
import type {
  NativeChatProfile,
  NativeProviderPort,
} from "./types";

interface HelperCallArgs<TExtra extends Record<string, unknown>> {
  readonly model: string;
  readonly system: string | undefined;
  readonly prompt?: string;
  readonly messages?: readonly Message[];
  readonly maxOutputTokens?: number;
  readonly settings?: Record<string, unknown>;
  readonly schema: z.ZodType | undefined;
  readonly outputSchema: JsonSchemaObject | undefined;
  readonly extra: TExtra;
}

/** Create lightweight text and structured generation helpers for one client port. */
export function createNativeChatHelpers<
  TRequest,
  TRawResponse,
  TRawStream extends AsyncIterable<unknown>,
  TExtra extends Record<string, unknown>,
  TDeps extends Record<string, unknown>,
  TProviderMessage,
  TClient,
>(
  profile: NativeChatProfile<
    TRequest,
    TRawResponse,
    TRawStream,
    TExtra,
    TDeps,
    TProviderMessage
  >,
  bind: (
    client: TClient,
  ) => NativeProviderPort<TRequest, TRawResponse, TRawStream>,
  deps: TDeps,
): NativeChatHelpers<TClient> {
  return Object.freeze({
    createGenerateTextFn(client: TClient, model: string): GenerateTextFn {
      const port = bind(client);
      return async (options) => {
        const args = helperCallArgs<TExtra>({
          model,
          system: options.system,
          ...(options.prompt !== undefined
            ? { prompt: options.prompt }
            : { messages: options.messages }),
          maxOutputTokens: options.maxOutputTokens,
          schema: undefined,
          outputSchema: undefined,
          extra: {} as TExtra,
        });
        const request = await profile.request(requestArgsFor(profile, args), {
          mode: "text",
          deps,
        });
        const raw = await port.call(request, "text");
        return { text: responseFor(profile, raw).text };
      };
    },

    createGenerateObjectFn(client: TClient): GenerateObjectFn {
      let port: NativeProviderPort<TRequest, TRawResponse, TRawStream> | undefined;
      return async (options) => {
        if (
          typeof options.model !== "string" ||
          options.model.trim().length === 0
        ) {
          throw new TypeError(
            "Native structured generation requires `options.model` to be a non-empty string.",
          );
        }
        if (!profile.structuredOutput) {
          throw new CruxUnsupportedStructuredOutputError(profile.providerId);
        }

        const plan = compileStructuredOutput(
          options.schema,
          profile.structuredOutput.accepts,
        );
        const args = helperCallArgs<TExtra>({
          model: options.model,
          system: options.system,
          ...(options.messages !== undefined
            ? { messages: options.messages }
            : { prompt: options.prompt }),
          settings: profile.settings({
            ...(options.temperature === undefined
              ? {}
              : { temperature: options.temperature }),
            ...(options.topP === undefined ? {} : { topP: options.topP }),
          }),
          schema: options.schema,
          outputSchema: plan.outputSchema,
          extra: {} as TExtra,
        });
        const request = await profile.request(requestArgsFor(profile, args), {
          mode: "structured",
          deps,
          outputSchema: plan.outputSchema,
        });
        const clientPort = port ?? (port = bind(client));
        const raw = await clientPort.call(request, "structured");
        const provided =
          profile.structuredObject?.(raw) ??
          parseJson(responseFor(profile, raw).text, profile.providerId);
        const decoded = decodeStructuredValue(provided, plan.decodeManifest);
        return { object: options.schema.parse(decoded) };
      };
    },
  });
}

function helperCallArgs<TExtra extends Record<string, unknown>>(
  args: HelperCallArgs<TExtra>,
): import("../types").CallArgs<TExtra> {
  const messages: Message[] = args.messages
    ? args.messages.map((message) => ({ ...message }))
    : [{ role: "user", content: args.prompt ?? "" }];
  return {
    model: args.model,
    system: args.system,
    systemBlocks: undefined,
    messages,
    settings:
      args.settings ??
      (args.maxOutputTokens === undefined
        ? {}
        : { maxTokens: args.maxOutputTokens }),
    schema: args.schema,
    outputSchema: args.outputSchema,
    tools: undefined,
    extra: args.extra,
  };
}

function parseJson(text: string, providerId: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new SyntaxError(
      `Native chat profile "${providerId}" returned structured output that is not valid JSON.`,
      { cause: error },
    );
  }
}
