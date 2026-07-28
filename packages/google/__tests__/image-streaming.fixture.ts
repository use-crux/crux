import type { GoogleGenAI, Interactions } from "@google/genai";
import { vi } from "vitest";

export const interactionCreated = {
  event_type: "interaction.created",
  event_id: "event-created",
  interaction: {
    id: "interaction-1",
    model: "gemini-3.1-flash-image",
    status: "in_progress",
  },
} as const satisfies Interactions.InteractionCreatedEvent;

export const interactionCompleted = {
  event_type: "interaction.completed",
  event_id: "event-completed",
  interaction: {
    id: "interaction-1",
    model: "gemini-3.1-flash-image",
    status: "completed",
    created: "2026-07-28T00:00:00Z",
    updated: "2026-07-28T00:00:03Z",
    usage: {
      total_input_tokens: 5,
      total_output_tokens: 13,
      total_tokens: 18,
      output_tokens_by_modality: [{ modality: "image", tokens: 13 }],
    },
  },
} as const satisfies Interactions.InteractionCompletedEvent;

export const sparseInterleavedEvents = [
  interactionCreated,
  imageDelta(7, "AQID", "image/png"),
  {
    event_type: "step.delta",
    index: 2,
    delta: { type: "text", text: "ignored text" },
  },
  imageDelta(2, "Bwg=", "image/webp"),
  imageDelta(7, "BAUG"),
  interactionCompleted,
] as const satisfies readonly Interactions.InteractionSSEEvent[];

export function imageDelta(
  index: number,
  data: string,
  mime_type?: string,
): Interactions.StepDelta {
  return {
    event_type: "step.delta",
    index,
    delta: {
      type: "image",
      data,
      ...(mime_type === undefined ? {} : { mime_type }),
    },
  };
}

export function clientWith(
  events: readonly Interactions.InteractionSSEEvent[],
) {
  return clientWithResponse(streamFrom(events));
}

export function clientWithResponse(response: unknown) {
  const create = vi.fn(async () => response);
  return {
    client: { interactions: { create } } as unknown as GoogleGenAI,
    create,
  };
}

export function cancellableClient(
  events: readonly Interactions.InteractionSSEEvent[],
) {
  const returned = deferred<void>();
  let requestSignal: AbortSignal | undefined;
  let index = 0;
  const iterator: AsyncIterator<Interactions.InteractionSSEEvent> = {
    next: async () => {
      const event = events[index++];
      if (event !== undefined) return { done: false, value: event };
      if (requestSignal?.aborted) throw requestSignal.reason;
      return new Promise<IteratorResult<Interactions.InteractionSSEEvent>>(
        (_resolve, reject) => {
          requestSignal?.addEventListener(
            "abort",
            () => reject(requestSignal?.reason),
            { once: true },
          );
        },
      );
    },
    return: async () => {
      returned.resolve();
      return { done: true, value: undefined };
    },
  };
  const create = vi.fn(
    async (_input: unknown, options?: { readonly signal?: AbortSignal }) => {
      requestSignal = options?.signal;
      return { [Symbol.asyncIterator]: () => iterator };
    },
  );
  return {
    client: { interactions: { create } } as unknown as GoogleGenAI,
    create,
    requestSignal: () => requestSignal,
    returned: returned.promise,
  };
}

export async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of stream) values.push(value);
  return values;
}

export async function waitFor(
  predicate: () => boolean,
  message: string,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error(message);
}

function streamFrom(events: readonly Interactions.InteractionSSEEvent[]) {
  return {
    async *[Symbol.asyncIterator]() {
      yield* events;
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}
