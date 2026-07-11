import type { Message } from "../generation/messages";
import type {
  AssistantContentPart,
  MediaSource,
  MessageContent,
} from "../types/content";

/** Media values accepted at the private invocation boundary. */
export type InvocationMediaSource = MediaSource;

/**
 * Content parts accepted at the private invocation boundary.
 *
 * Widened to `AssistantContentPart` because assistant messages may carry
 * `ToolCallPart`/`ReasoningPart` lifecycle output alongside ordinary
 * text/media parts.
 */
export type InvocationContentPart = AssistantContentPart;

/** Message shape consumed by the private persisted-message codec. */
export type InvocationMessage = Message;
