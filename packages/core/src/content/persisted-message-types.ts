import type { AssetInfo, AssetRef } from "../asset";
import type { Message } from "../generation/messages";
import type { JsonObject, ProviderOptions } from "../types/tool";

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
      readonly type: "image" | "file";
      readonly source: PersistedMediaSource;
      readonly mediaType?: string;
      readonly filename?: string;
      readonly providerOptions?: ProviderOptions;
    };

export type PersistedMessage = Readonly<{
  role: Message["role"];
  content: string | readonly PersistedContentPart[];
  metadata?: JsonObject;
}>;
