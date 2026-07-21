/** Provider-capture fixture shared by direct retrieval ingress tests. */

import type { AdapterSpec } from "../../src/adapter/spec";
import type { AdapterResponse, CallArgs } from "../../src/adapter/types";

interface TestStream extends AsyncIterable<{ readonly text: string }> {}

/** Capture every Core provider request while returning deterministic text. */
export function capturingRetrievalAdapter(
  calls: CallArgs[],
): AdapterSpec<object, { ok: true }, TestStream> {
  return {
    providerId: "retrieval-input-safety",
    async call(_client, args) {
      calls.push(args);
      return { raw: { ok: true }, extracted: response("done") };
    },
    async stream(_client, args) {
      calls.push(args);
      const rawStream: TestStream = (async function* () {
        yield { text: "done" };
      })();
      return {
        rawStream,
        extractTextDelta: (chunk) => (chunk as { readonly text?: string }).text,
        completion: async () => ({ text: "done", finishReason: "stop" }),
      };
    },
    appendToolRound(messages) {
      return messages;
    },
    mapSettings(settings) {
      return { ...settings };
    },
  };
}

/** Drain a canonical Core text stream. */
export async function consumeTextStream(
  stream: AsyncIterable<string>,
): Promise<void> {
  for await (const _chunk of stream) {
    // Consumption drives completion for Core streams.
  }
}

function response(text: string): AdapterResponse {
  return {
    text,
    toolCalls: undefined,
    usage: undefined,
    finishReason: "stop",
    responseId: undefined,
    actualModelId: undefined,
  };
}
