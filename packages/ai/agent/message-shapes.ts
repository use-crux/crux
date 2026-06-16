/** Minimal structural shape of AI SDK message parts read by agent middleware. */
export interface MessagePart {
  type?: string
  text?: string
  delta?: string
  toolCallId?: string
  output?: { type: string; value?: unknown; reason?: string }
}

/** Minimal structural shape of AI SDK conversation messages read by middleware. */
export interface PromptMessage {
  role: string
  content?: string | MessagePart[]
}
