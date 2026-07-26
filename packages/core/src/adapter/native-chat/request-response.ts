/**
 * Shared native-chat request assembly and response normalization.
 *
 * @module
 */

import type { Message } from "../../generation/messages";
import type { AdapterResponse, CallArgs } from "../types";
import { assertProviderMediaSupported } from "./media-hooks";
import type {
  NativeChatProfile,
  NativeChatRequestArgs,
  NativeTranscriptCodec,
} from "./types";

/** Add provider-native transcript messages after validating canonical media. */
export function requestArgsFor<
  TRequest,
  TRawResponse,
  TRawStream extends AsyncIterable<unknown>,
  TExtra extends Record<string, unknown>,
  TDeps extends Record<string, unknown>,
  TProviderMessage,
>(
  profile: Pick<
    NativeChatProfile<
      TRequest,
      TRawResponse,
      TRawStream,
      TExtra,
      TDeps,
      TProviderMessage
    >,
    "media" | "providerId" | "transcript"
  >,
  args: CallArgs<TExtra>,
): NativeChatRequestArgs<TExtra, TProviderMessage> {
  assertProviderMediaSupported(profile, {
    model: args.model,
    messages: args.messages,
  });
  return {
    ...args,
    providerMessages: providerMessagesFor(profile, args.messages),
  };
}

function providerMessagesFor<TProviderMessage, TRawResponse>(
  profile: {
    readonly transcript: NativeTranscriptCodec<TProviderMessage, TRawResponse>;
  },
  messages: readonly Message[],
): readonly TProviderMessage[] {
  return profile.transcript.fromMessages(messages);
}

/** Normalize one provider response through its transcript and metadata hooks. */
export function responseFor<
  TRequest,
  TRawResponse,
  TRawStream extends AsyncIterable<unknown>,
  TExtra extends Record<string, unknown>,
  TDeps extends Record<string, unknown>,
  TProviderMessage,
>(
  profile: Pick<
    NativeChatProfile<
      TRequest,
      TRawResponse,
      TRawStream,
      TExtra,
      TDeps,
      TProviderMessage
    >,
    "providerId" | "response" | "transcript"
  >,
  raw: TRawResponse,
  request?: TRequest,
): AdapterResponse {
  const assistant = profile.transcript.readAssistant(raw, { request });
  const text = profile.response.text?.(raw, assistant) ?? assistant.text;
  const content =
    text !== assistant.text
      ? [{ type: "text" as const, text }]
      : assistant.content === undefined
        ? undefined
        : typeof assistant.content === "string"
          ? [{ type: "text" as const, text: assistant.content }]
          : assistant.content;
  return {
    ...profile.response.meta(raw),
    ...(content !== undefined ? { content } : {}),
    text,
    toolCalls: assistant.toolCalls,
  };
}
