import type { AdapterSpec } from "../src/adapter";
import type { AdapterResponse } from "../src/adapter/types";
import type { ThreadCommit } from "../src/thread";

export function response(
  text: string,
  toolCalls?: Array<{ id: string; name: string; args: unknown }>,
): AdapterResponse {
  return {
    text,
    toolCalls,
    usage: undefined,
    finishReason: "stop",
    responseId: undefined,
    actualModelId: undefined,
  };
}

export function simpleSpec(
  text: string,
): AdapterSpec<object, object, never> {
  return {
    providerId: "thread-test",
    async call() {
      return { raw: {}, extracted: response(text) };
    },
    async stream() {
      throw new Error("not used");
    },
    appendToolRound: (messages) => messages,
    mapSettings: (settings) => ({ ...settings }),
  };
}

export function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

export async function* chunks(
  values: readonly string[],
): AsyncIterable<string> {
  yield* values;
}

export function receipt(...messageIds: string[]): ThreadCommit {
  return {
    status: "selected",
    messageIds,
    selectedHead: messageIds.at(-1)!,
    committedAt: new Date(0).toISOString(),
    replayed: false,
  };
}

export async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("condition was not reached");
}

export function replaceLastAssistant(
  messages: readonly unknown[],
  text: string,
): readonly unknown[] {
  let index = -1;
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
    const message = messages[messageIndex];
    if (
      typeof message === "object" &&
      message !== null &&
      "role" in message &&
      message.role === "assistant"
    ) {
      index = messageIndex;
      break;
    }
  }
  return messages.map((message, messageIndex) =>
    messageIndex === index && typeof message === "object" && message !== null
      ? { ...message, content: text }
      : message,
  );
}
