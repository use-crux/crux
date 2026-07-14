/** Provider stream tracking and Safety text replacement. @internal */

import type { SafetyStream } from "../../safety/session";
import { createSafetyTextChunk } from "./stream-safety";

interface TrackRawStreamOptions {
  readonly rawStream: AsyncIterable<unknown>;
  readonly extractTextDelta: (chunk: unknown) => string | undefined;
  readonly safetyStream?: SafetyStream;
  readonly appendText: (text: string) => void;
  readonly close: () => Promise<void>;
}

/** Yield provider chunks while tracking and replacing Safety text deltas. */
export function trackRawStream<TRawStream>(
  options: TrackRawStreamOptions,
): TRawStream & AsyncIterable<unknown> {
  async function* tracked() {
    type Chunk = Awaited<TRawStream extends AsyncIterable<infer T> ? T : never>;
    try {
      for await (const chunk of options.rawStream) {
        const delta = options.extractTextDelta(chunk);
        if (!options.safetyStream || delta === undefined || delta === "") {
          if (delta) options.appendText(delta);
          yield chunk as Chunk;
          continue;
        }
        const directive = await options.safetyStream.feed(delta);
        if (directive.kind === "hold") continue;
        options.appendText(directive.content);
        if (directive.content === delta) {
          yield chunk as Chunk;
        } else if (directive.content.length > 0) {
          yield createSafetyTextChunk(directive.content) as Chunk;
        }
      }
      if (options.safetyStream) {
        const seal = await options.safetyStream.finish();
        if (seal.pending.length > 0) {
          options.appendText(seal.pending);
          yield createSafetyTextChunk(seal.pending) as Chunk;
        }
      }
    } finally {
      await options.close();
    }
  }

  return tracked() as unknown as TRawStream & AsyncIterable<unknown>;
}
