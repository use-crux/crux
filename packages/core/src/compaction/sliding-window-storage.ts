import type { Storage } from "../storage";
import type { Message } from "../generation/messages";
import { createInvalidMediaSourceError } from "../content/media-errors";
import { decodePersistedMessages } from "../content/persisted-message-decode";
import {
  encodePersistedMessages,
  rollbackAssets,
  type EncodeState,
} from "../content/persisted-message";
import { isPersistedMessages } from "../content/persisted-message-validation";

export interface SlidingWindowState {
  readonly summary: string;
  readonly messages: readonly Message[];
}

/** Load one private, atomic summary-and-window state record. */
export async function loadSlidingWindowState(
  storage: Storage,
  key: string,
): Promise<SlidingWindowState> {
  const record = await storage.records.get(key);
  if (!record) return { summary: "", messages: [] };
  if (
    typeof record.summary !== "string" ||
    !isPersistedMessages(record.messages)
  ) {
    throw createInvalidMediaSourceError({
      path: "record.state",
      reason:
        "Sliding-window state must contain a summary and persisted messages.",
    });
  }
  return {
    summary: record.summary,
    messages: await decodePersistedMessages({
      storage,
      messages: record.messages,
    }),
  };
}

/** Persist media and then commit summary plus window through one record write. */
export async function saveSlidingWindowState(
  storage: Storage,
  key: string,
  state: SlidingWindowState,
): Promise<void> {
  const encodeState: EncodeState = {
    storage,
    dedupe: new Map(),
    writtenRefs: [],
  };
  try {
    const messages = await encodePersistedMessages(state.messages, encodeState);
    await storage.records.put(key, {
      summary: state.summary,
      messages,
    });
  } catch (error) {
    await rollbackAssets(storage.assets, encodeState.writtenRefs);
    throw error;
  }
}
