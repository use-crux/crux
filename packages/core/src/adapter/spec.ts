/**
 * `AdapterSpec` — the lower-level execution IR for single-turn adapters.
 *
 * Provider packages should normally author `defineSingleTurnProviderBundle()`.
 * Core compiles that public bundle through the single-turn provider runtime
 * into this IR for execution tests and internal adapter plumbing.
 *
 * @module
 */

import type { GenerationSettings } from "../generation/types";
import type { Message } from "../generation/messages";
import type {
  AdapterResponse,
  CallArgs,
  StreamHandle,
  ToolResultEntry,
} from "./types";
import type { CruxProviderError } from "./normalized-outcome";
import type { ToolSourceMaterializer } from "../tools/tool-source";
import type { StructuredOutputCapabilities } from "./structured-output";

// ─────────────────────────────────────────────────────────────────
// AdapterSpec Interface
// ─────────────────────────────────────────────────────────────────

/**
 * Provider-specific single-turn execution specification.
 *
 * Prefer `defineSingleTurnProviderBundle()` for public adapter authoring. The
 * base `adapter()` handles all shared orchestration: tool loops, fallback,
 * devtools, compositions.
 *
 * @typeParam TClient - The provider's SDK client type
 * @typeParam TRawResponse - The provider's raw API response type
 * @typeParam TRawStream - The provider's raw stream type
 * @typeParam TExtra - Provider-specific options (e.g., tool_choice for Anthropic)
 * @typeParam TParams - Provider-native non-streaming request params.
 */
export interface AdapterSpec<
  TClient,
  TRawResponse = unknown,
  TRawStream = unknown,
  TExtra extends Record<string, unknown> = Record<string, unknown>,
  TParams = unknown,
> {
  /** Provider identifier for adaptation matching (e.g., 'anthropic', 'openai'). */
  readonly providerId: string;

  /** Materialize an inert prompt tool source for one adapter invocation. */
  readonly materializeToolSource?: ToolSourceMaterializer;

  /** Execute a non-streaming API call. Returns canonical + raw SDK response. */
  call(
    client: TClient,
    args: CallArgs<TExtra>,
    context?: { readonly signal: AbortSignal | undefined },
  ): Promise<{ raw: TRawResponse; extracted: AdapterResponse }>;

  /** Execute a streaming API call. Returns a stream handle. */
  stream(
    client: TClient,
    args: CallArgs<TExtra>,
    context?: { readonly signal: AbortSignal | undefined },
  ): Promise<StreamHandle<TRawStream>>;

  /** Translate canonical call args into provider-native params for public codecs and handles. */
  toParams?(args: CallArgs<TExtra>): TParams | Promise<TParams>;

  /** Normalize a provider-native response supplied to a call handle. */
  fromResponse?(response: TRawResponse): AdapterResponse;

  /**
   * Format assistant response + tool results for the next tool loop turn.
   * Each provider represents tool results differently.
   */
  appendToolRound(
    messages: Message[],
    assistantResponse: AdapterResponse,
    toolResults: ToolResultEntry[],
  ): Message[];

  /** Map canonical GenerationSettings to provider-native field names. */
  mapSettings(settings: GenerationSettings): Record<string, unknown>;

  /**
   * Classify a thrown provider SDK error into the normalized taxonomy.
   *
   * Returning `undefined` defers to core's generic classification
   * (timeout/abort/provider-error). Providers implement this to recognize
   * their own rate-limit, invalid-request, refusal, and server errors.
   */
  mapError?(error: unknown): CruxProviderError | undefined;

  /** Post-process z.toJSONSchema() output for this provider (optional). */
  sanitizeToolSchema?(schema: Record<string, unknown>): Record<string, unknown>;

  /**
   * The JSON Schema behavior this provider accepts for structured output.
   *
   * Inert capability data; core compiles the authored schema against `accepts`
   * and supplies the lowered schema through the call args. Absent means
   * structured output is unsupported and fails before a network request.
   */
  structuredOutput?: {
    readonly accepts: StructuredOutputCapabilities;
  };
}
