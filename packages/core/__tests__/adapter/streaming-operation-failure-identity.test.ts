import { describe, expect, it } from "vitest";
import { fallback } from "../../src/generation/fallback";
import { TimeoutError } from "../../src/generation/timeout";
import {
  collectFailure,
  createTestImageStream,
  deferred,
  mapTestEvent,
} from "./streaming-operation-test-helpers";

describe("streaming operation failure identity", () => {
  it("shares one caller-abort object with every public and source surface", async () => {
    const fixture = pendingStream();
    const controller = new AbortController();
    const reason = new Error("caller stopped");
    const result = await fixture.streamImage({
      model: "image-model",
      prompt: "A quiet canal",
      abortSignal: controller.signal,
    });
    await fixture.published.promise;
    const currentPromise = collectFailure(result.fullStream);

    controller.abort(reason);

    const current = await currentPromise;
    const late = await collectFailure(result.fullStream);
    expect(current.error).toBe(reason);
    expect(late.error).toBe(reason);
    expect(fixture.signal()?.reason).toBe(reason);
    await expect(result.completion).rejects.toBe(reason);
  });

  it("normalizes cancel(reason) once and prevents another routed attempt", async () => {
    const fixture = pendingStream();
    const result = await fixture.streamImage({
      model: fallback(["primary", "backup"]),
      prompt: "A quiet canal",
    });
    await fixture.published.promise;
    const currentPromise = collectFailure(result.fullStream);

    result.cancel("stop");

    const current = await currentPromise;
    const late = await collectFailure(result.fullStream);
    expect(current.error).toBeInstanceOf(DOMException);
    expect((current.error as DOMException).name).toBe("AbortError");
    expect(late.error).toBe(current.error);
    expect(fixture.signal()?.reason).toBe(current.error);
    await expect(result.completion).rejects.toBe(current.error);
    await Promise.resolve();
    expect(fixture.opened).toEqual(["primary"]);
  });

  it("preserves a provider failure object for current and future readers", async () => {
    const failure = new Error("native stream failed");
    const streamImage = createTestImageStream({
      open: async () => ({
        events: (async function* () {
          yield { sequence: 0 };
          throw failure;
        })(),
        map: mapTestEvent,
        completion: new Promise<never>(() => {}),
      }),
    });
    const result = await streamImage({
      model: "image-model",
      prompt: "A quiet canal",
    });

    const current = await collectFailure(result.fullStream);
    const late = await collectFailure(result.fullStream);

    expect(current.error).toBe(failure);
    expect(late.error).toBe(failure);
    await expect(result.completion).rejects.toBe(failure);
  });

  it("shares the canonical timeout and detaches only an early reader", async () => {
    const fixture = pendingStream();
    const result = await fixture.streamImage({
      model: "image-model",
      prompt: "A quiet canal",
      timeout: { stepMs: 10 },
    });
    const early = result.fullStream[Symbol.asyncIterator]();
    await expect(early.next()).resolves.toMatchObject({
      value: { type: "start" },
    });
    await early.return?.();

    const current = await collectFailure(result.fullStream);
    const late = await collectFailure(result.fullStream);

    expect(TimeoutError.isInstance(current.error)).toBe(true);
    expect(current.error).toMatchObject({ budget: "step" });
    expect(late.error).toBe(current.error);
    expect(fixture.signal()?.reason).toBe(current.error);
    await expect(result.completion).rejects.toBe(current.error);
  });
});

function pendingStream() {
  const published = deferred<void>();
  const opened: string[] = [];
  let signal: AbortSignal | undefined;
  const streamImage = createTestImageStream({
    open: async (input, context) => {
      opened.push(String(input.model));
      signal = context.signal;
      return {
        events: (async function* () {
          yield { sequence: 0 };
          await new Promise<never>(() => {});
        })(),
        map: (event) => {
          published.resolve();
          return mapTestEvent(event);
        },
        completion: new Promise<never>(() => {}),
      };
    },
  });
  return { streamImage, published, opened, signal: () => signal };
}
