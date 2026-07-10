import type { Asset } from "../asset";
import type { Message } from "../generation/messages";
import type { JsonObject, JsonValue, ProviderOptions } from "../types/tool";

/** Media values accepted at the private invocation boundary. */
export type InvocationMediaSource =
  | Asset
  | string
  | URL
  | Uint8Array
  | ArrayBuffer
  | Blob;

/** Final-shape private content parts used before the public Phase 04 flip. */
export type InvocationContentPart =
  | {
      readonly type: "text";
      readonly text: string;
      readonly providerOptions?: ProviderOptions;
    }
  | {
      readonly type: "image";
      readonly source: InvocationMediaSource;
      readonly mediaType?: string;
      readonly providerOptions?: ProviderOptions;
    }
  | {
      readonly type: "file";
      readonly source: InvocationMediaSource;
      readonly mediaType?: string;
      readonly filename?: string;
      readonly providerOptions?: ProviderOptions;
    };

/** Message shape consumed by the private persisted-message codec. */
export type InvocationMessage = Readonly<{
  role: Message["role"];
  content: string | readonly InvocationContentPart[];
  metadata?: JsonObject;
}>;

/** Provider options copied through private JSON codecs. */
export type InvocationProviderOptions = Readonly<
  Record<string, Readonly<Record<string, JsonValue>>>
>;
