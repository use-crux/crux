import type { Message } from "../generation/messages";
import type {
  ContentPart,
  MediaSource,
  MessageContent,
} from "../types/content";

/** Media values accepted at the private invocation boundary. */
export type InvocationMediaSource = MediaSource;

/** Content parts accepted at the private invocation boundary. */
export type InvocationContentPart = ContentPart;

/** Message shape consumed by the private persisted-message codec. */
export type InvocationMessage = Message;
