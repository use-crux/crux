import type { GoogleGenAI, Interactions } from "@google/genai";
import type { Asset, ImageStreamEvent } from "@use-crux/core";
import type { NormalizedGoogleImageStream } from "./image-streaming-options";
import {
  appendGoogleImageBase64,
  createGoogleImageAssembly,
  flushGoogleImageBase64,
  googleImageAsset,
  type GoogleImageAssembly,
} from "./image-streaming-base64";

type ImageStreamCandidate = Exclude<
  ImageStreamEvent,
  { readonly type: "start" | "image" | "finish" }
>;

/** Native terminal data retained until Core validates and publishes final images. */
export interface GoogleImageStreamCompletion {
  readonly raw: Interactions.InteractionCompletedEvent;
  readonly images: readonly [Asset, ...Asset[]];
}

/** Open one image-only beta Interactions stream with no continuation state. */
export async function openGoogleImageStream(
  client: GoogleGenAI,
  normalized: NormalizedGoogleImageStream,
  signal: AbortSignal,
  call: <T>(operation: string, start: () => Promise<T>) => Promise<T>,
) {
  const stream = await call("image.generate", () =>
    client.interactions.create(
      {
        api_version: "v1beta",
        model: normalized.options.model,
        input: normalized.prompt.text,
        response_format: { type: "image" },
        store: false,
        stream: true,
      },
      { signal },
    ),
  );
  if (!isAsyncIterable<Interactions.InteractionSSEEvent>(stream)) {
    throw new TypeError(
      "Google image streaming requires an async iterable SDK response.",
    );
  }

  const terminal = deferredTerminal(signal);
  const assembler = new GoogleImageStreamAssembler(terminal);
  return {
    events: captureGoogleImageStream(stream, terminal),
    map(event: Interactions.InteractionSSEEvent) {
      try {
        return assembler.map(event);
      } catch (error) {
        terminal.reject(error);
        throw error;
      }
    },
    completion: terminal.promise,
  };
}

class GoogleImageStreamAssembler {
  readonly #byStep = new Map<number, GoogleImageAssembly>();
  readonly #outputs: GoogleImageAssembly[] = [];
  readonly #terminal: TerminalDeferred;
  #interactionId?: string;
  #terminalSeen = false;

  constructor(terminal: TerminalDeferred) {
    this.#terminal = terminal;
  }

  map(
    event: Interactions.InteractionSSEEvent,
  ): ImageStreamCandidate | readonly ImageStreamCandidate[] | undefined {
    if (this.#terminalSeen) {
      throw new TypeError(
        "Google image stream emitted an event after interaction.completed.",
      );
    }
    switch (event.event_type) {
      case "interaction.created":
        this.#created(event);
        return undefined;
      case "step.delta":
        return event.delta.type === "image"
          ? this.#imageDelta(event)
          : undefined;
      case "interaction.completed":
        return this.#completed(event);
      case "interaction.status_update":
        if (
          event.status !== "queued" &&
          event.status !== "in_progress" &&
          event.status !== "completed"
        ) {
          throw new Error(
            `Google image interaction entered terminal status "${event.status}".`,
            { cause: event },
          );
        }
        return undefined;
      case "error":
        throw new Error(
          event.error?.message ?? "Google image interaction failed.",
          { cause: event },
        );
      default:
        return undefined;
    }
  }

  #created(event: Interactions.InteractionCreatedEvent): void {
    if (this.#interactionId !== undefined) {
      throw new TypeError(
        "Google image stream emitted more than one interaction.created event.",
      );
    }
    this.#interactionId = event.interaction.id;
  }

  #imageDelta(event: Interactions.StepDelta): ImageStreamCandidate | undefined {
    if (this.#interactionId === undefined) {
      throw new TypeError(
        "Google image stream emitted an image delta before interaction.created.",
      );
    }
    if (!Number.isSafeInteger(event.index) || event.index < 0) {
      throw new TypeError(
        "Google image stream step indexes must be non-negative safe integers.",
      );
    }
    let assembly = this.#byStep.get(event.index);
    if (assembly === undefined) {
      assembly = createGoogleImageAssembly(event.index, this.#outputs.length);
      this.#byStep.set(event.index, assembly);
      this.#outputs.push(assembly);
    }
    const data = appendGoogleImageBase64(
      assembly,
      event.delta.type === "image" ? event.delta.data : undefined,
      event.delta.type === "image" ? event.delta.mime_type : undefined,
    );
    return data === undefined ? undefined : imageDeltaEvent(assembly, data);
  }

  #completed(
    event: Interactions.InteractionCompletedEvent,
  ): readonly ImageStreamCandidate[] | undefined {
    if (this.#interactionId === undefined) {
      throw new TypeError(
        "Google image stream completed before interaction.created.",
      );
    }
    if (event.interaction.id !== this.#interactionId) {
      throw new TypeError(
        "Google image stream changed interaction identity before completion.",
      );
    }
    if (event.interaction.status !== "completed") {
      throw new Error(
        `Google image interaction completed with status "${event.interaction.status}".`,
        { cause: event },
      );
    }
    if (this.#outputs.length === 0) {
      throw new TypeError(
        "Google image stream completed without any image deltas.",
      );
    }

    this.#terminalSeen = true;
    const flushed = this.#outputs.flatMap((assembly) => {
      const data = flushGoogleImageBase64(assembly);
      return data === undefined ? [] : [imageDeltaEvent(assembly, data)];
    });
    const images = this.#outputs.map(googleImageAsset) as [Asset, ...Asset[]];
    this.#terminal.resolve({
      raw: event,
      images: Object.freeze(images),
    });
    return flushed.length === 0 ? undefined : flushed;
  }
}

function imageDeltaEvent(
  assembly: GoogleImageAssembly,
  data: Uint8Array,
): ImageStreamCandidate {
  const sequence = assembly.sequence;
  assembly.sequence += 1;
  return {
    type: "image-delta",
    data,
    mediaType: assembly.mediaType!,
    outputIndex: assembly.outputIndex,
    sequence,
  };
}

async function* captureGoogleImageStream(
  stream: AsyncIterable<Interactions.InteractionSSEEvent>,
  terminal: TerminalDeferred,
): AsyncGenerator<Interactions.InteractionSSEEvent> {
  try {
    for await (const event of stream) yield event;
    if (!terminal.settled()) {
      terminal.reject(
        new TypeError(
          "Google image stream ended without an interaction.completed event.",
        ),
      );
    }
  } catch (error) {
    terminal.reject(error);
    throw error;
  } finally {
    if (!terminal.settled()) {
      terminal.reject(
        new TypeError(
          "Google image stream closed before its interaction.completed event.",
        ),
      );
    }
    terminal.dispose();
  }
}

interface TerminalDeferred {
  readonly promise: Promise<GoogleImageStreamCompletion>;
  resolve(value: GoogleImageStreamCompletion): void;
  reject(error: unknown): void;
  settled(): boolean;
  dispose(): void;
}

function deferredTerminal(signal: AbortSignal): TerminalDeferred {
  let settled = false;
  let resolvePromise!: (value: GoogleImageStreamCompletion) => void;
  let rejectPromise!: (error: unknown) => void;
  const promise = new Promise<GoogleImageStreamCompletion>(
    (resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    },
  );
  const rejectTerminal = (error: unknown): void => {
    if (settled) return;
    settled = true;
    signal.removeEventListener("abort", onAbort);
    rejectPromise(error);
  };
  const onAbort = () => rejectTerminal(signal.reason);
  signal.addEventListener("abort", onAbort, { once: true });
  return {
    promise,
    resolve(value) {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      resolvePromise(value);
    },
    reject: rejectTerminal,
    settled: () => settled,
    dispose: () => signal.removeEventListener("abort", onAbort),
  };
}

function isAsyncIterable<T>(value: unknown): value is AsyncIterable<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    Symbol.asyncIterator in value &&
    typeof value[Symbol.asyncIterator] === "function"
  );
}
