import type { Asset } from "../asset";
import type { Storage } from "../storage";
import type { ProviderOptions } from "../types/tool";
import { createInvalidMediaSourceError } from "./media-errors";
import type {
  InvocationContentPart,
  InvocationMessage,
} from "./invocation-types";
import { clonePrivateJsonObject } from "./json-private";
import type {
  PersistedAssistantContentPart,
  PersistedMediaSource,
  PersistedMessage,
} from "./persisted-message-types";

export interface DecodePersistedMessagesInput {
  readonly storage: Storage;
  readonly messages: readonly PersistedMessage[];
}

/** Decode persisted JSON messages and hydrate every asset ref before use. */
export async function decodePersistedMessages(
  input: DecodePersistedMessagesInput,
): Promise<readonly InvocationMessage[]> {
  const decoded: InvocationMessage[] = [];
  for (const [messageIndex, message] of input.messages.entries()) {
    decoded.push(await decodeMessage(message, messageIndex, input.storage));
  }
  return decoded;
}

async function decodeMessage(
  message: PersistedMessage,
  messageIndex: number,
  storage: Storage,
): Promise<InvocationMessage> {
  return {
    role: message.role,
    content:
      typeof message.content === "string"
        ? message.content
        : await decodeParts(message.content, messageIndex, storage),
    ...(message.metadata
      ? { metadata: clonePrivateJsonObject(message.metadata) }
      : {}),
  } as InvocationMessage;
}

async function decodeParts(
  parts: readonly PersistedAssistantContentPart[],
  messageIndex: number,
  storage: Storage,
): Promise<readonly InvocationContentPart[]> {
  const decoded: InvocationContentPart[] = [];
  for (const [partIndex, part] of parts.entries()) {
    const path = `messages[${messageIndex}].content[${partIndex}]`;
    if (part.type === "text") {
      decoded.push({ ...part });
    } else if (part.type === "tool-call") {
      decoded.push({
        type: "tool-call",
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: part.input,
        ...(part.providerOptions
          ? { providerOptions: cloneProviderOptions(part.providerOptions) }
          : {}),
      });
    } else if (part.type === "reasoning") {
      decoded.push({
        type: "reasoning",
        text: part.text,
        ...(part.providerOptions
          ? { providerOptions: cloneProviderOptions(part.providerOptions) }
          : {}),
      });
    } else if (part.type === "image" || part.type === "audio" || part.type === "video") {
      decoded.push({
        type: part.type,
        source: await decodeMediaSource(part.source, `${path}.source`, storage),
        ...(part.mediaType ? { mediaType: part.mediaType } : {}),
        ...(part.providerOptions
          ? { providerOptions: cloneProviderOptions(part.providerOptions) }
          : {}),
      });
    } else {
      decoded.push({
        type: "file",
        source: await decodeMediaSource(part.source, `${path}.source`, storage),
        ...(part.mediaType ? { mediaType: part.mediaType } : {}),
        ...(part.filename ? { filename: part.filename } : {}),
        ...(part.providerOptions
          ? { providerOptions: cloneProviderOptions(part.providerOptions) }
          : {}),
      });
    }
  }
  return decoded;
}

async function decodeMediaSource(
  source: PersistedMediaSource,
  path: string,
  storage: Storage,
): Promise<Asset> {
  if (source.type === "asset-ref") {
    if (!storage.assets) {
      throw createInvalidMediaSourceError({
        path,
        reason: "Asset-ref media sources require their owning AssetStore.",
      });
    }
    try {
      return await storage.assets.get(source.ref);
    } catch {
      throw createInvalidMediaSourceError({
        path,
        reason: "Unable to hydrate asset-ref media source.",
      });
    }
  }
  if (source.type === "url") {
    let url: URL;
    try {
      url = new URL(source.url);
    } catch {
      throw createInvalidMediaSourceError({
        path,
        reason: "Persisted URL media source is invalid.",
      });
    }
    return {
      type: "url",
      url,
      ...(source.mediaType ? { mediaType: source.mediaType } : {}),
      ...copyInfo(source.info),
    };
  }
  return {
    type: "provider-file",
    provider: source.provider,
    fileId: source.fileId,
    ...(source.mediaType ? { mediaType: source.mediaType } : {}),
    ...copyInfo(source.info),
  };
}

function copyInfo(
  info: PersistedMediaSource["info"],
): NonNullable<PersistedMediaSource["info"]> {
  return {
    ...(info?.filename !== undefined ? { filename: info.filename } : {}),
    ...(info?.size !== undefined ? { size: info.size } : {}),
    ...(info?.sha256 !== undefined ? { sha256: info.sha256 } : {}),
    ...(info?.width !== undefined ? { width: info.width } : {}),
    ...(info?.height !== undefined ? { height: info.height } : {}),
    ...(info?.durationInSeconds !== undefined
      ? { durationInSeconds: info.durationInSeconds }
      : {}),
    ...(info?.pageCount !== undefined ? { pageCount: info.pageCount } : {}),
  };
}

function cloneProviderOptions(
  providerOptions: ProviderOptions,
): ProviderOptions {
  return clonePrivateJsonObject(providerOptions) as ProviderOptions;
}
