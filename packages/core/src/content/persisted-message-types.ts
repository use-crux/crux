import type { AssetInfo, AssetRef } from "../asset";
import type { Message } from "../generation/messages";
import type { JsonObject, JsonValue, ProviderOptions } from "../types/tool";

export type PersistedMediaSource =
  | {
      readonly type: "asset-ref";
      readonly ref: AssetRef;
      readonly mediaType: string;
      readonly info?: AssetInfo;
    }
  | {
      readonly type: "url";
      readonly url: string;
      readonly mediaType?: string;
      readonly info?: AssetInfo;
    }
  | {
      readonly type: "provider-file";
      readonly provider: string;
      readonly fileId: string;
      readonly mediaType?: string;
      readonly info?: AssetInfo;
    };

export type PersistedContentPart =
  | {
      readonly type: "text";
      readonly text: string;
      readonly providerOptions?: ProviderOptions;
    }
  | {
      readonly type: "image" | "audio" | "video" | "file";
      readonly source: PersistedMediaSource;
      readonly mediaType?: string;
      readonly filename?: string;
      readonly providerOptions?: ProviderOptions;
    };

/** Persisted form of assistant-only `ToolCallPart` lifecycle output. */
export type PersistedToolCallPart = {
  readonly type: "tool-call";
  readonly toolCallId: string;
  readonly toolName: string;
  readonly input: JsonValue;
  readonly providerOptions?: ProviderOptions;
};

/** Persisted form of assistant-only `ReasoningPart` lifecycle output. */
export type PersistedReasoningPart = {
  readonly type: "reasoning";
  readonly text: string;
  readonly providerOptions?: ProviderOptions;
};

/** Persisted assistant content: ordinary parts plus lifecycle output. */
export type PersistedAssistantContentPart =
  | PersistedContentPart
  | PersistedToolCallPart
  | PersistedReasoningPart;

type PersistedMessageMetadata = Readonly<{ metadata?: JsonObject }>;

/** Persisted messages retain the same assistant-only lifecycle law as runtime messages. */
export type PersistedMessage =
  | (Readonly<{
      role: "assistant";
      content: string | readonly PersistedAssistantContentPart[];
    }> &
      PersistedMessageMetadata)
  | (Readonly<{
      role: Exclude<Message["role"], "assistant">;
      content: string | readonly PersistedContentPart[];
    }> &
      PersistedMessageMetadata);
