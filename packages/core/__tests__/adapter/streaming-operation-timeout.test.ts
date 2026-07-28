import { describe, expect, it } from "vitest";
import { fallback } from "../../src/generation/fallback";
import { TimeoutError } from "../../src/generation/timeout";
import { boundary, guardrail } from "../../src/safety";
import {
  collect,
  collectFailure,
  createTestImageStream,
  deferred,
  mapTestEvent,
} from "./streaming-operation-test-helpers";

describe("streaming operation deadlines", () => {
  it("applies totalMs to preflight before a native source opens", async () => {
    let opened = false;
    const streamImage = createTestImageStream({
      normalize: async () => new Promise<never>(() => {}),
      open: async () => {
        opened = true;
        throw new Error("unreachable");
      },
    });

    const error = await streamImage({
      model: "image-model",
      prompt: "A quiet canal",
      timeout: { totalMs: 5 },
    }).catch((reason: unknown) => reason);

    expect(error).toMatchObject({
      name: "TimeoutError",
      budget: "total",
      limitMs: 5,
    } satisfies Partial<TimeoutError>);
    expect(TimeoutError.isInstance(error)).toBe(true);
    expect(opened).toBe(false);
  });

  it("keeps one totalMs wall across every routed physical attempt", async () => {
    const opened: string[] = [];
    const signals: AbortSignal[] = [];
    const primaryFailure = Object.assign(new Error("primary unavailable"), {
      status: 503,
    });
    const streamImage = createTestImageStream({
      open: async (input, { signal }) => {
        const model = String(input.model);
        opened.push(model);
        signals.push(signal);
        return {
          events: (async function* () {
            if (model === "primary") throw primaryFailure;
            await new Promise<never>(() => {});
          })(),
          map: mapTestEvent,
          completion: new Promise<never>(() => {}),
        };
      },
    });
    const result = await streamImage({
      model: fallback(["primary", "backup"]),
      prompt: "A quiet canal",
      timeout: { totalMs: 20 },
    });

    const outcome = await collectFailure(result.fullStream);

    expect(opened).toEqual(["primary", "backup"]);
    expect(outcome.error).toMatchObject({
      name: "TimeoutError",
      budget: "total",
    } satisfies Partial<TimeoutError>);
    expect(signals[1]?.reason).toBe(outcome.error);
    await expect(result.completion).rejects.toBe(outcome.error);
  });

  it("applies stepMs between progressive events through native completion", async () => {
    let sourceSignal: AbortSignal | undefined;
    let iteratorReleased = false;
    const streamImage = createTestImageStream({
      open: async (_input, { signal }) => {
        sourceSignal = signal;
        return {
          events: {
            [Symbol.asyncIterator]() {
              let sequence = 0;
              return {
                next: async () =>
                  sequence++ === 0
                    ? { done: false as const, value: { sequence: 0 } }
                    : new Promise<never>(() => {}),
                return: async () => {
                  iteratorReleased = true;
                  return { done: true as const, value: undefined };
                },
              };
            },
          },
          map: mapTestEvent,
          completion: new Promise<never>(() => {}),
        };
      },
    });
    const result = await streamImage({
      model: "image-model",
      prompt: "A quiet canal",
      timeout: { stepMs: 5, totalMs: 100 },
    });

    const current = await collectFailure(result.fullStream);
    const late = await collectFailure(result.fullStream);

    expect(current.values.map(({ type }) => type)).toEqual([
      "start",
      "image-delta",
    ]);
    expect(current.error).toMatchObject({
      name: "TimeoutError",
      budget: "step",
    } satisfies Partial<TimeoutError>);
    expect(late.error).toBe(current.error);
    expect(sourceSignal?.reason).toBe(current.error);
    expect(iteratorReleased).toBe(true);
    await expect(result.completion).rejects.toBe(current.error);
  });

  it("includes retained final Safety work in totalMs", async () => {
    const streamImage = createTestImageStream({
      open: async () => ({
        events: (async function* () {})(),
        map: mapTestEvent,
        completion: Promise.resolve({ requestId: "request-1" }),
      }),
    });
    const result = await streamImage({
      model: "image-model",
      prompt: "A quiet canal",
      timeout: { totalMs: 5 },
      guardrails: [
        guardrail({
          id: "pending-final-policy",
          on: boundary.output.media(),
          run: async () => new Promise<never>(() => {}),
        }),
      ],
    });

    const outcome = await collectFailure(result.fullStream);

    expect(outcome.values.map(({ type }) => type)).toEqual(["start"]);
    expect(outcome.error).toMatchObject({
      name: "TimeoutError",
      budget: "total",
    } satisfies Partial<TimeoutError>);
  });

  it("has no idle deadline and no implicit timeout default", async () => {
    const release = deferred<void>();
    const completion = deferred<Readonly<{ requestId: string }>>();
    const streamImage = createTestImageStream({
      open: async () => ({
        events: (async function* () {
          yield { sequence: 0 };
          await release.promise;
          yield { sequence: 1 };
          completion.resolve({ requestId: "request-1" });
        })(),
        map: mapTestEvent,
        completion: completion.promise,
      }),
    });
    const result = await streamImage({
      model: "image-model",
      prompt: "A quiet canal",
    });
    const eventsPromise = collect(result.fullStream);

    await new Promise((resolve) => setTimeout(resolve, 20));
    release.resolve();

    const events = await eventsPromise;
    expect(events.map(({ type }) => type)).toEqual([
      "start",
      "image-delta",
      "image-delta",
      "image",
      "finish",
    ]);
  });
});
