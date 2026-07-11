import type { AssetRef, AssetStore } from "../asset";
import type { JsonObject as StorageJsonObject, Storage } from "../storage";
import type { InvocationMessage } from "./invocation-types";
import {
  encodePersistedMessages,
  type EncodeState,
} from "./persisted-message-encode";
import type {
  PersistedAssistantContentPart,
  PersistedContentPart,
  PersistedMediaSource,
  PersistedMessage,
} from "./persisted-message-types";
export {
  decodePersistedMessages,
  type DecodePersistedMessagesInput,
} from "./persisted-message-decode";
export {
  loadPersistedMessagesRecord,
  type LoadPersistedMessagesRecordInput,
} from "./persisted-message-record";
export { encodePersistedMessages, type EncodeState } from "./persisted-message-encode";

export type {
  PersistedAssistantContentPart,
  PersistedContentPart,
  PersistedMediaSource,
  PersistedMessage,
};

export interface SavePersistedMessagesRecordInput {
  readonly storage: Storage;
  readonly key: string;
  readonly messages: readonly InvocationMessage[];
}

/**
 * Persist invocation messages as private JSON after all owned media writes
 * succeed.
 */
export async function savePersistedMessagesRecord(
  input: SavePersistedMessagesRecordInput,
): Promise<void> {
  const state: EncodeState = {
    storage: input.storage,
    dedupe: new Map(),
    writtenRefs: [],
  };
  try {
    const messages = await encodePersistedMessages(input.messages, state);
    await input.storage.records.put(input.key, {
      messages,
    } as StorageJsonObject);
  } catch (error) {
    await rollbackAssets(input.storage.assets, state.writtenRefs);
    throw error;
  }
}

/** Delete assets written during a save that ultimately failed. */
export async function rollbackAssets(
  assets: AssetStore | undefined,
  refs: readonly AssetRef[],
): Promise<void> {
  if (!assets) return;
  for (const ref of refs.slice().reverse()) {
    await assets.delete(ref).catch(() => undefined);
  }
}
