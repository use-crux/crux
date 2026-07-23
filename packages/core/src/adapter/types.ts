/**
 * Core types for the provider adapter abstraction.
 *
 * These types define the canonical shapes used by `adapter()` to
 * orchestrate tool loops and normalize responses across AI providers.
 *
 * @module
 */

import type { z } from "zod";
import type { GenerationMeta, TokenUsage } from "../generation/types";
import type { RoutingReceipt } from "../routing/receipt";
import type { JsonSchemaObject } from "./structured-output";
import type { SystemBlock } from "../resolver/types";
import type { Message } from "../generation/messages";
import type { ToolModelOutput } from "../types/tool";
import type { CruxFinishReason } from "./normalized-outcome";
import type { AssistantContentPart } from "../types/content";

// ─────────────────────────────────────────────────────────────────
// Adapter Response
// ─────────────────────────────────────────────────────────────────

/** Canonical response -- what the base uses for tool loop logic. */
export interface AdapterResponse {
  /** Exact ordered assistant output, when the provider exposes rich parts. */
  content?: readonly AssistantContentPart[];
  text: string;
  toolCalls: Array<{ id: string; name: string; args: unknown }> | undefined;
  /** Provider-reported usage, omitted when the provider did not return enough counts to build a real usage record. */
  usage: TokenUsage | undefined;
  /** Normalized, provider-neutral finish reason (adapters map their native value into this). */
  finishReason: CruxFinishReason | undefined;
  responseId: string | undefined;
  actualModelId: string | undefined;
  /** Non-fatal provider warnings for this response. */
  warnings?: readonly unknown[];
  /** Provider-owned metadata preserved without interpretation. */
  providerMetadata?: unknown;
}

// ─────────────────────────────────────────────────────────────────
// Call Args
// ─────────────────────────────────────────────────────────────────

/** Canonical args assembled by the base from prompt resolution. */
export interface CallArgs<
  TExtra extends Record<string, unknown> = Record<string, unknown>,
> {
  model: string;
  system: string | undefined;
  /**
   * System message blocks with optional provider-level caching hints.
   * Joining all `block.text` with `\n\n` produces the `system` string.
   * Adapters that support provider caching use `providerCache` to identify
   * the stable prefix and `cacheBoundary` to emit one native cache marker.
   */
  systemBlocks: readonly SystemBlock[] | undefined;
  messages: Message[];
  settings: Record<string, unknown>;
  schema: z.ZodType | undefined;
  /**
   * Provider-compatible JSON Schema compiled from the authored schema, supplied
   * to the request builder. Undefined for non-structured requests.
   */
  outputSchema: JsonSchemaObject | undefined;
  tools:
    | Array<{
        name: string;
        description: string;
        parameters: Record<string, unknown>;
        execute: (
          args: unknown,
          options?: {
            readonly toolCallId?: string;
            readonly messages?: readonly unknown[];
          },
        ) => unknown | Promise<unknown>;
        toModelOutput?: (args: {
          toolCallId: string;
          input: Record<string, unknown>;
          output: unknown;
        }) => ToolModelOutput | Promise<ToolModelOutput>;
      }>
    | undefined;
  extra: TExtra;
}

// ─────────────────────────────────────────────────────────────────
// Stream Handle
// ─────────────────────────────────────────────────────────────────

/** Stream handle returned by the adapter's stream method. */
export interface StreamHandle<TRawStream> {
  /** Original provider stream handle, when distinct from the wrapped iterable. */
  raw?: TRawStream;
  rawStream: TRawStream & AsyncIterable<unknown>;
  extractTextDelta: (chunk: unknown) => string | undefined;
  /** Routing receipt attached by core when a stream used routing wrappers. */
  routing?: RoutingReceipt;
  completion: () => Promise<StreamCompletionMetadata | undefined>;
}

/** Exact buffered facts available after a provider-native stream completes. */
export interface StreamCompletionMetadata extends GenerationMeta {
  /** Final text projection, when supplied independently of stream deltas. */
  readonly text?: string;
  /** Exact ordered assistant output buffered while the stream ran. */
  readonly content?: readonly AssistantContentPart[];
  /** Complete canonical transcript, when supplied by the provider runtime. */
  readonly messages?: readonly Message[];
  /** Non-fatal warnings reported by the provider. */
  readonly warnings?: readonly unknown[];
  /** Provider-owned completion metadata. */
  readonly providerMetadata?: unknown;
}

// ─────────────────────────────────────────────────────────────────
// Tool Result
// ─────────────────────────────────────────────────────────────────

/** Tool result to feed back into the next call. */
export interface ToolResultEntry {
  toolCallId: string;
  name: string;
  output?: unknown;
  modelOutput: ToolModelOutput;
  content: string;
  outputSize: number;
  modelOutputSize: number;
  modelOutputError?: string;
  isError?: boolean;
}

// ─────────────────────────────────────────────────────────────────
// Status Delta
// ─────────────────────────────────────────────────────────────────

/** Status delta for counter-based operations. Same shape as plan/status. */
export type StatusDelta =
  | { readonly type: "add" }
  | { readonly type: "update"; readonly from: string; readonly to: string }
  | { readonly type: "remove"; readonly status: string };
