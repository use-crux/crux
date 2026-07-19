import { adapter, prompt } from "@use-crux/core";
import type {
  AdapterResponse,
  AdapterSpec,
  StreamCompletionMetadata,
  StreamHandle,
} from "@use-crux/core/adapter";
import { z } from "zod";

export interface StreamFixtureOptions {
  readonly chunks?: readonly string[];
  readonly completion?: Promise<StreamCompletionMetadata | undefined>;
  readonly iterationError?: Error;
  readonly freezeHandle?: boolean;
  readonly onCompletion?: () => void;
}

export function createFakeAdapter(options: StreamFixtureOptions = {}) {
  const spec: AdapterSpec<
    object,
    FakeRawResponse,
    AsyncIterable<string>
  > = {
    providerId: "fake-stream-correlation",
    async call() {
      const raw = { id: "provider-response", text: "Hello" };
      return { raw, extracted: responseFrom(raw) };
    },
    async stream(_client, args): Promise<StreamHandle<AsyncIterable<string>>> {
      const structured = args.schemaParams !== undefined;
      const values =
        options.chunks ??
        (structured ? ['{"answer":', "42}"] : ["Hello", " stream"]);
      const handle: StreamHandle<AsyncIterable<string>> = {
        rawStream: chunks(values, options.iterationError),
        extractTextDelta: (chunk) =>
          typeof chunk === "string" ? chunk : undefined,
        completion: () => {
          options.onCompletion?.();
          return (
            options.completion ?? Promise.resolve(defaultCompletion(structured))
          );
        },
      };
      return options.freezeHandle ? Object.freeze(handle) : handle;
    },
    appendToolRound(messages) {
      return messages;
    },
    mapSettings() {
      return {};
    },
    wrapOutputSchema() {
      return { response_format: "json" };
    },
  };
  return adapter(spec)({});
}

export function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

export const textPrompt = prompt({
  id: "text-stream-result-correlation",
  input: z.object({ message: z.string() }),
  prompt: ({ input }) => input.message,
});

export const structuredPrompt = prompt({
  id: "structured-stream-result-correlation",
  input: z.object({ message: z.string() }),
  output: z.object({ answer: z.number() }),
  prompt: ({ input }) => input.message,
});

function defaultCompletion(structured: boolean): StreamCompletionMetadata {
  return {
    text: structured ? '{"answer":42}' : "Hello stream",
    ...(structured ? { object: { answer: 42 } } : {}),
    responseId: "provider-stream-response",
    finishReason: "stop",
    usage: {
      inputTokens: 1,
      outputTokens: 2,
      totalTokens: 3,
      inputTokenDetails: {},
      outputTokenDetails: {},
    },
  };
}

interface FakeRawResponse {
  readonly id: string;
  readonly text: string;
}

function responseFrom(raw: FakeRawResponse): AdapterResponse {
  return {
    text: raw.text,
    responseId: raw.id,
    finishReason: "stop",
  };
}

async function* chunks(
  values: readonly string[],
  error: Error | undefined,
): AsyncIterable<string> {
  yield* values;
  if (error) throw error;
}
