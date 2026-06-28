/**
 * Core SDK-agnostic base type surface.
 *
 * This module owns the few provider-neutral primitives that do not belong to a
 * single product domain: the SDK aliases ({@link AnyModel}, {@link AnyToolSet},
 * {@link AnyMessage}), the static project tool catalog entry ({@link FlowToolDef}),
 * and provider/model metadata ({@link ModelInfo}). They are intentionally
 * dependency-free so every domain can import them without creating a cycle.
 *
 * Domain-owned types live in their domain modules — import them from there:
 * - prompt/context authoring → `prompt/context-types.ts`,
 *   `prompt/prompt-types.ts`, `prompt/type-utils.ts`;
 * - prompt resolution/inspection output → `resolver/types.ts`;
 * - runtime middleware contracts → `runtime/types.ts`;
 * - generation policy (settings, adaptation, usage, trace) → `generation/types.ts`.
 *
 * @module
 */

import type { z } from 'zod'

// ─────────────────────────────────────────────────────────────────
// Base Types (SDK-agnostic)
// ─────────────────────────────────────────────────────────────────

/** SDK-agnostic model reference. Each adapter narrows this to its SDK's model type. */
export type AnyModel = unknown

/** SDK-agnostic tool set. Each adapter narrows this to its SDK's tool format. */
export type AnyToolSet = Record<string, unknown>

/** SDK-agnostic message for multi-turn prompts. */
export type AnyMessage = { role: string; content: unknown }

// ─────────────────────────────────────────────────────────────────
// Project Tool Catalog
// ─────────────────────────────────────────────────────────────────

/**
 * Declarative tool definition for the project tool catalog — name,
 * description, and parameter schema.
 *
 * These are plain data (no runtime implementation). Local tooling discovers
 * statically visible tool definitions from source so devtools and the project
 * index can present the tool surface alongside prompts and contexts.
 *
 * @example
 * ```ts
 * import { z } from 'zod'
 *
 * const searchDocs: FlowToolDef = {
 *   name: 'search_docs',
 *   description: 'Search the documentation index for relevant pages.',
 *   parameters: z.object({ query: z.string() }),
 * }
 * ```
 */
export interface FlowToolDef {
  /** Tool name as the model will see it. */
  name: string
  /** Description shown to the model. */
  description: string
  /** Zod schema for the tool's parameters. */
  parameters: z.ZodType
}

// ─────────────────────────────────────────────────────────────────
// Model Info (used by adapters and resolve pipeline)
// ─────────────────────────────────────────────────────────────────

/** Extracted provider and model ID, used for adaptation matching. */
export interface ModelInfo {
  /** Provider identifier (e.g. `"openai"`, `"anthropic"`, `"google"`). */
  provider: string
  /** Model identifier (e.g. `"gpt-4o"`, `"openai/gpt-4o"`). */
  modelId: string
}
