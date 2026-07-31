/**
 * `@use-crux/convex` — Convex storage adapter for Crux.
 *
 * Provides Convex-backed records and asset storage plus profile helpers for
 * Convex request lifecycles.
 *
 * **Setup:** Install the crux Convex component and use the component ref:
 *
 * ```ts
 * import { convexStorage } from '@use-crux/convex'
 * import { components } from './_generated/api'
 *
 * const storage = convexStorage({ component: components.crux, ctx })
 * await storage.records.put('memory:alpha', { content: 'Alpha' })
 * ```
 *
 * @module
 */

export { convexAssetStore } from "./workspace";
export type { ConvexAssetStoreConfig } from "./workspace";
export { convexRecordStore, convexStorage, convexVectorStore } from "./storage";
export type { ConvexStorageConfig } from "./storage";
export { flushObservability, withObservabilityFlush } from "./observability";
export type {
  ConvexActionHandler,
  ConvexObservabilityFlushOptions,
} from "./observability";
export { setup } from "./bridge";
export type {
  CruxConvexBridgeHttpRouter,
  CruxConvexBridgeSetupOptions,
} from "./bridge";
export { createCruxConvex } from "./profile";
export type {
  CreateCruxConvexOptions,
  CruxConvexComponents,
  CruxConvexProfile,
  CruxConvexProfileAgentConfig,
  CruxConvexRunScope,
} from "./profile";
export { convexComponentDocumentPort } from "./store";
export type {
  ConvexComponentDocumentPortConfig,
  ConvexContext,
  ConvexCtxPort,
  ConvexMemoryStoreConfig,
} from "./store";
export {
  createInMemoryConvexStoreDocumentComponent,
  isConvexStoreDocumentComponent,
} from "./store-document-component";
export { createConvexTransport } from "./react";
export type { ConvexTransportConfig, CruxTransport, UseQueryFn } from "./react";
export type {
  InMemoryConvexStoreDocumentComponent,
  InMemoryConvexStoreDocumentComponentOptions,
} from "./store-document-component";
export type {
  ConvexCruxStorageComponent,
  ConvexCruxStorageMemoryComponent,
  ConvexCruxStorageTransportComponent,
  ConvexStoreDocumentComponent,
  ConvexStoreDocumentComponentReadOptions,
} from "./store-component";
export type {
  ComponentDocumentPort,
  StoreDocPage,
  StoreDocPageQuery,
  StoreDocRecord,
  StoreDocWrite,
} from "./store-doc";
export {
  context,
  contributor,
  createContexts,
  createPrompts,
  contentText,
  escapeXml,
  hasMediaParts,
  limit,
  match,
  messageText,
  prompt,
  raw,
  safe,
  textPart,
  truncate,
  userContent,
  when,
  wrap,
} from "@use-crux/core";
export type {
  AnyPrompt,
  ConditionalContext,
  Context,
  ContextDef,
  ContextEntry,
  ContentPart,
  ContextSystemArg,
  CompactionResult,
  ContributorConfig,
  Contribution,
  ContributorEntry,
  MergedInput,
  Message,
  MessageContent,
  Prompt,
  PromptConfig,
  PromptTree,
  PromptTreeResult,
  ResolveOptions,
  ResolvedPrompt,
} from "@use-crux/core";
export {
  convexRuntimeRecords,
  convexRuntimeStorage,
  getConvexCruxRuntime,
  resolveConvexMemoryNamespace,
  runWithConvexCruxRuntime,
} from "./runtime";
export type {
  ConvexCruxRuntime,
  ConvexMemoryNamespace,
  ConvexMemoryNamespaceArgs,
  ConvexRuntimeTarget,
} from "./runtime";
export {
  convexAgent,
  generateImage,
  generateSpeech,
  transcribe,
} from "./agent";

import type { z } from "zod";
import type {
  Context,
  ContextEntry,
  Prompt,
} from "@use-crux/core";
import type { ConvexContext } from "./store";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────
// Context Handler Helper
// ─────────────────────────────────────────────────────────────────

/** Generic message type compatible with Convex Agent SDK's ModelMessage. */
interface SystemMessage {
  role: "system";
  content: string;
}

/** Arguments passed to the context handler by the Convex Agent SDK. */
export interface ContextHandlerArgs {
  allMessages: Array<{ role: string; content: unknown }>;
  search: Array<{ role: string; content: unknown }>;
  recent: Array<{ role: string; content: unknown }>;
  inputMessages: Array<{ role: string; content: unknown }>;
  inputPrompt: Array<{ role: string; content: unknown }>;
  existingResponses: Array<{ role: string; content: unknown }>;
  userId: string | undefined;
  threadId: string | undefined;
}

/** Configuration for `createContextHandler()`. */
export interface ContextHandlerConfig<TInput extends Record<string, unknown>> {
  /**
   * Handler that returns the contexts to compose and the input to pass to them.
   *
   * - `contexts`: Array of Context objects (from `context()`, `.asContext()`, etc.)
   * - `input`: Merged input object passed to each context's `.systemFn()`
   *
   * Memory `.asContext()` contexts resolve their own data from their backing store.
   * Only custom contexts (project, draft, compaction) need data in the input object.
   */
  handler: (
    ctx: ConvexContext,
    args: ContextHandlerArgs,
  ) => Promise<{ contexts: Context<z.ZodType>[]; input: TInput }>;
}

/**
 * Create a composable context handler for the Convex Agent SDK.
 *
 * Replaces manual string concatenation in context handlers with declarative
 * context composition. Calls each context's `.systemFn(input)`, filters empties,
 * joins with double newlines, and returns Convex Agent-compatible messages.
 *
 * @example
 * ```ts
 * const contextHandler = createContextHandler({
 *   handler: async (ctx, args) => ({
 *     contexts: [
 *       currentDate,
 *       agentProjectContext,
 *       sessionMemory.asContext({ priority: 90 }),
 *       blackboard.asContext({ priority: 85 }),
 *     ],
 *     input: {
 *       lines: await fetchProjectLines(ctx, projectId),
 *     },
 *   }),
 * })
 * ```
 */
export function createContextHandler<TInput extends Record<string, unknown>>(
  config: ContextHandlerConfig<TInput>,
): (
  ctx: ConvexContext,
  args: ContextHandlerArgs,
) => Promise<Array<{ role: string; content: unknown }>> {
  return async (ctx, args) => {
    const { contexts, input } = await config.handler(ctx, args);

    // Resolve all contexts in parallel
    // Context.systemFn takes the merged input and returns the system text
    const parts = await Promise.all(
      contexts.map(async (c) => {
        try {
          const text = await c.systemFn(input as Record<string, unknown>);
          return typeof text === "string" ? text : "";
        } catch {
          return "";
        }
      }),
    );

    const systemContent = parts.filter(Boolean).join("\n\n");

    if (!systemContent) {
      return args.allMessages;
    }

    const systemMessage: SystemMessage = {
      role: "system",
      content: systemContent,
    };
    return [systemMessage, ...args.allMessages];
  };
}
