/**
 * Shared provider-neutral generation function types.
 *
 * Provides framework-agnostic generate function abstractions that any SDK
 * (Vercel AI SDK, OpenAI, Google GenAI) can implement.
 *
 * @module
 */

import type { z } from "zod";
import type { Message } from "./messages";
import type { RoutingReceipt } from "../routing/receipt";

// ── Generate Function Abstractions ──────────────────────────────────

/** Common controls accepted by a framework-agnostic text generation call. */
interface GenerateTextCommonOptions {
  readonly model: unknown;
  readonly system?: string;
  readonly maxOutputTokens?: number;
}

/** Framework-agnostic text generation function. Wraps any SDK's generateText. */
export type GenerateTextFn = (
  options: GenerateTextCommonOptions &
    (
      | { readonly prompt: string; readonly messages?: never }
      | { readonly messages: readonly Message[]; readonly prompt?: never }
    ),
) => Promise<{ text: string; routing?: RoutingReceipt }>;

/**
 * Common controls accepted by a framework-agnostic structured generation call.
 *
 * @typeParam T - Structured value produced after schema validation.
 */
export interface GenerateObjectCommonOptions<T> {
  /** Model reference resolved by the implementation for this call. */
  readonly model: unknown;
  /** Optional system instruction applied before the prompt or messages. */
  readonly system?: string;
  /** Zod schema describing and validating the returned object. */
  readonly schema: z.ZodType<T>;
  /** Provider temperature forwarded when the caller needs deterministic generation. */
  readonly temperature?: number;
  /** Provider nucleus-sampling setting forwarded when the caller needs deterministic generation. */
  readonly topP?: number;
}

/**
 * Exclusive canonical input accepted by structured generation.
 *
 * Canonical messages preserve multimodal content for provider adapters. A
 * caller supplies exactly one input form.
 */
export type GenerateObjectInput =
  | { readonly prompt: string; readonly messages?: never }
  | { readonly messages: readonly Message[]; readonly prompt?: never };

/**
 * Framework-agnostic structured output function.
 *
 * Accepts either a text prompt or canonical messages. Provider-native helpers
 * send `schema` to their provider's structured-output mechanism and return the
 * provider/schema validated `{ object }`. They do not imply the full Crux
 * prompt runtime: prompt resolution, validation retry, safety, Eval evidence,
 * tools, memory, and instrumentation are only present when the helper is
 * explicitly adapter-backed, such as one created with
 * `createGenerateObjectFnFromGenerate()`.
 *
 * @typeParam T - Structured value produced after schema validation.
 */
export type GenerateObjectFn = <T>(
  options: GenerateObjectCommonOptions<T> & GenerateObjectInput,
) => Promise<{
  readonly object: T;
  readonly routing?: RoutingReceipt;
}>;
