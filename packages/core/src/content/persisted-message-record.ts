import type { Storage } from "../storage";
import type { InvocationMessage } from "./invocation-types";
import { createInvalidMediaSourceError } from "./media-errors";
import { decodePersistedMessages } from "./persisted-message-decode";
import { isPersistedMessages } from "./persisted-message-validation";

export interface LoadPersistedMessagesRecordInput {
  readonly storage: Storage;
  readonly key: string;
}

/** Load one private message record and hydrate all owned asset references. */
export async function loadPersistedMessagesRecord(
  input: LoadPersistedMessagesRecordInput,
): Promise<readonly InvocationMessage[]> {
  const record = await input.storage.records.get(input.key);
  if (!record) return [];
  if (!isPersistedMessages(record.messages)) {
    throw createInvalidMediaSourceError({
      path: "record.messages",
      reason: "Persisted messages must use the private JSON message format.",
    });
  }
  return decodePersistedMessages({
    storage: input.storage,
    messages: record.messages,
  });
}
