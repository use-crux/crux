import type Anthropic from '@anthropic-ai/sdk'

/** Provider-specific extra options for the Anthropic adapter. */
export interface AnthropicExtra extends Record<string, unknown> {
  /** Anthropic tool definitions for function calling, bypassing Crux tool conversion. */
  readonly tools?: Anthropic.ToolUnion[]
  /** Anthropic tool choice strategy. */
  readonly tool_choice?: Anthropic.ToolChoice
}

/** Provider-native message request assembled by the Anthropic provider runtime. */
export interface AnthropicRequest extends Record<string, unknown> {
  /** Anthropic model identifier. */
  readonly model: string
  /** Anthropic request transcript. */
  readonly messages: Anthropic.MessageParam[]
}
