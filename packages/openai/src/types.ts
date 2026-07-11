import type OpenAI from 'openai'

/** Provider-specific extra options for the OpenAI chat adapter. */
export interface OpenAIExtra extends Record<string, unknown> {
  /** Native output modalities requested from an audio-capable chat model. */
  readonly modalities?: readonly ("text" | "audio")[]
  /** Native generated-audio voice and container format. */
  readonly audio?: {
    readonly format: "wav" | "mp3" | "flac" | "opus" | "pcm16"
    readonly voice: string
  }
  /** OpenAI tool definitions for function calling, bypassing Crux tool conversion. */
  readonly tools?: OpenAI.ChatCompletionTool[]
  /** OpenAI tool choice strategy. */
  readonly tool_choice?: OpenAI.ChatCompletionToolChoiceOption
  /** Whether OpenAI may emit multiple tool calls in one assistant turn. */
  readonly parallel_tool_calls?: boolean
}

/** Provider-native chat request assembled by the OpenAI provider runtime. */
export interface OpenAIChatRequest extends Record<string, unknown> {
  /** Model identifier passed to OpenAI. */
  readonly model: string
  /** OpenAI chat-completion transcript. */
  readonly messages: OpenAI.ChatCompletionMessageParam[]
}

/** Configuration for a Crux dense embedding backed by OpenAI embeddings. */
export interface OpenAIEmbeddingConfig {
  /** Crux embedding name. */
  readonly name: string
  /** OpenAI embedding model id. */
  readonly model: string
  /** Override output dimensions for custom or dimension-selectable models. */
  readonly dimensions?: number
  /** Maximum input tokens advertised to Crux callers. */
  readonly maxInputTokens?: number
  /** Batch sizing and concurrency hints for Crux embedding calls. */
  readonly batch?: {
    readonly maxSize?: number
    readonly concurrency?: number
  }
  /** Optional OpenAI user identifier forwarded to embeddings.create(). */
  readonly user?: string
}
