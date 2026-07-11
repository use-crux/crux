import type { Asset, AssetInfo, AssetRef, StoredAsset } from "../asset";
import type { Storage } from "../storage";
import { sha256Hex } from "./sha256";
import { createInvalidMediaSourceError } from "./media-errors";
import { normalizeInvocationMediaSource } from "./invocation-media";
import type {
  InvocationContentPart,
  InvocationMessage,
} from "./invocation-types";
import {
  projectPersistedJsonValue,
  projectPersistedMetadata,
  projectPersistedProviderOptions,
} from "./persisted-message-json";
import type {
  PersistedAssistantContentPart,
  PersistedContentPart,
  PersistedMediaSource,
  PersistedMessage,
} from "./persisted-message-types";

export interface EncodeState {
  readonly storage: Storage;
  readonly dedupe: Map<string, StoredAsset>;
  readonly writtenRefs: AssetRef[];
}

/** Encode invocation messages into the private JSON persisted form. */
export async function encodePersistedMessages(
  messages: readonly InvocationMessage[],
  state: EncodeState,
): Promise<readonly PersistedMessage[]> {
  const encoded: PersistedMessage[] = [];
  for (const [messageIndex, message] of messages.entries()) {
    encoded.push(await encodeMessage(message, messageIndex, state));
  }
  return encoded;
}

async function encodeMessage(
  message: InvocationMessage,
  messageIndex: number,
  state: EncodeState,
): Promise<PersistedMessage> {
  const metadata = projectPersistedMetadata(
    message.metadata,
    `messages[${messageIndex}].metadata`,
  );
  if (message.role === "assistant") {
    return {
      role: "assistant",
      content:
        typeof message.content === "string"
          ? message.content
          : await encodeParts(message.content, messageIndex, state, true),
      ...(metadata ? { metadata } : {}),
    };
  }
  return {
    role: message.role,
    content:
      typeof message.content === "string"
        ? message.content
        : await encodeParts(message.content, messageIndex, state, false),
    ...(metadata ? { metadata } : {}),
  };
}

function encodeParts(
  parts: readonly InvocationContentPart[],
  messageIndex: number,
  state: EncodeState,
  allowLifecycle: false,
): Promise<readonly PersistedContentPart[]>;
function encodeParts(
  parts: readonly InvocationContentPart[],
  messageIndex: number,
  state: EncodeState,
  allowLifecycle: true,
): Promise<readonly PersistedAssistantContentPart[]>;
async function encodeParts(
  parts: readonly InvocationContentPart[],
  messageIndex: number,
  state: EncodeState,
  allowLifecycle: boolean,
): Promise<readonly PersistedAssistantContentPart[]> {
  const encoded: PersistedAssistantContentPart[] = [];
  for (const [partIndex, part] of parts.entries()) {
    const path = partPath(messageIndex, partIndex);
    if (part.type === "text") {
      encoded.push({
        type: "text",
        text: part.text,
        ...projectPersistedProviderOptions(
          part.providerOptions,
          `${path}.providerOptions`,
        ),
      });
    } else if (part.type === "tool-call") {
      if (!allowLifecycle)
        throw createInvalidMediaSourceError({
          path,
          reason: "Tool calls are assistant-only content.",
        });
      encoded.push({
        type: "tool-call",
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: projectPersistedJsonValue(part.input, `${path}.input`),
        ...projectPersistedProviderOptions(
          part.providerOptions,
          `${path}.providerOptions`,
        ),
      });
    } else if (part.type === "reasoning") {
      if (!allowLifecycle)
        throw createInvalidMediaSourceError({
          path,
          reason: "Reasoning is assistant-only content.",
        });
      encoded.push({
        type: "reasoning",
        text: part.text,
        ...projectPersistedProviderOptions(
          part.providerOptions,
          `${path}.providerOptions`,
        ),
      });
    } else {
      const source = await encodeMediaPart(part, path, state);
      encoded.push({
        type: part.type,
        source,
        ...(part.mediaType
          ? { mediaType: source.mediaType ?? part.mediaType }
          : {}),
        ...(part.type === "file" && part.filename
          ? { filename: part.filename }
          : {}),
        ...projectPersistedProviderOptions(
          part.providerOptions,
          `${path}.providerOptions`,
        ),
      });
    }
  }
  return encoded;
}

async function encodeMediaPart(
  part: Extract<
    InvocationContentPart,
    { readonly type: "image" | "audio" | "video" | "file" }
  >,
  path: string,
  state: EncodeState,
): Promise<PersistedMediaSource> {
  const normalized = await normalizeInvocationMediaSource({
    kind: part.type,
    source: part.source,
    path: `${path}.source`,
    ...(part.mediaType ? { mediaType: part.mediaType } : {}),
    ...(part.type === "file" && part.filename
      ? { filename: part.filename }
      : {}),
  });
  const stored = storedRef(part.source)
    ? ({ ...normalized, ref: storedRef(part.source) } as StoredAsset)
    : undefined;
  if (stored) return persistedAssetRef(stored, `${path}.source`);
  if (normalized.type === "data")
    return persistedOwnedData(normalized, `${path}.source`, state);
  if (normalized.type === "url") {
    return {
      type: "url",
      url: normalized.url.href,
      ...(normalized.mediaType ? { mediaType: normalized.mediaType } : {}),
      ...projectInfo(normalized),
    };
  }
  return {
    type: "provider-file",
    provider: normalized.provider,
    fileId: normalized.fileId,
    ...(normalized.mediaType ? { mediaType: normalized.mediaType } : {}),
    ...projectInfo(normalized),
  };
}

async function persistedOwnedData(
  asset: Extract<Asset, { readonly type: "data" }>,
  path: string,
  state: EncodeState,
): Promise<PersistedMediaSource> {
  if (!state.storage.assets) {
    throw createInvalidMediaSourceError({
      path,
      reason:
        "Data media requires Storage.assets before messages can be persisted.",
    });
  }
  const key = `${asset.mediaType}:${asset.sha256 ?? sha256Hex(await dataBytes(asset.data))}`;
  const existing = state.dedupe.get(key);
  if (existing) return persistedAssetRef(existing, path);
  const stored = await state.storage.assets.put(asset);
  state.writtenRefs.push(stored.ref);
  state.dedupe.set(key, stored);
  return persistedAssetRef(stored, path);
}

function persistedAssetRef(
  asset: StoredAsset,
  path: string,
): PersistedMediaSource {
  const mediaType = asset.mediaType;
  if (!mediaType) {
    throw createInvalidMediaSourceError({
      path,
      reason: "Stored media refs require a mediaType.",
    });
  }
  return {
    type: "asset-ref",
    ref: { uri: asset.ref.uri },
    mediaType,
    ...projectInfo(asset),
  };
}

function projectInfo(asset: Asset): { readonly info?: AssetInfo } {
  const info = copyInfo(asset);
  return Object.keys(info).length > 0 ? { info } : {};
}

function copyInfo(info: AssetInfo | undefined): AssetInfo {
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

async function dataBytes(data: Uint8Array | Blob): Promise<Uint8Array> {
  return data instanceof Uint8Array
    ? new Uint8Array(data)
    : new Uint8Array(await data.arrayBuffer());
}

function storedRef(value: unknown): AssetRef | undefined {
  return isRecord(value) &&
    isRecord(value.ref) &&
    typeof value.ref.uri === "string"
    ? { uri: value.ref.uri }
    : undefined;
}

function partPath(messageIndex: number, partIndex: number): string {
  return `messages[${messageIndex}].content[${partIndex}]`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
