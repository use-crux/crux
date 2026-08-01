import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { signal } from "@use-crux/core";
import { SignalError } from "@use-crux/core/signal";

afterEach(() => vi.restoreAllMocks());

describe("Signal idempotency", () => {
  it("replays the original receipt for the same key and normalized payload", async () => {
    const normalized = signal({
      id: "item.normalized",
      schema: z.object({
        slug: z.string().transform((value) => value.trim().toLowerCase()),
        attributes: z.record(z.string(), z.number()),
      }),
    });
    const listener = vi.fn();
    normalized.subscribe(listener);

    const first = await normalized.publish(
      { slug: "  ITEM-123 ", attributes: { beta: 2, alpha: 1 } },
      { idempotencyKey: "provider-event-1" },
    );
    const replay = await normalized.publish(
      { slug: "item-123", attributes: { alpha: 1, beta: 2 } },
      { idempotencyKey: "provider-event-1" },
    );
    await flushScheduledListeners();

    expect(replay).toBe(first);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("rejects conflicting idempotency reuse before another occurrence exists", async () => {
    const changed = signal({
      id: "setting.changed",
      schema: z.object({ value: z.string() }),
    });
    const listener = vi.fn();
    changed.subscribe(listener);
    const randomUuid = vi.spyOn(globalThis.crypto, "randomUUID");
    const idempotencyKey = "private-provider-key";

    await changed.publish(
      { value: "original-private-value" },
      { idempotencyKey },
    );
    const conflict = await changed
      .publish(
        { value: "different-private-value" },
        { idempotencyKey },
      )
      .catch((error: unknown) => error);
    await flushScheduledListeners();

    expect(conflict).toBeInstanceOf(SignalError);
    expect(conflict).toMatchObject({ code: "idempotency_conflict" });
    expect(String(conflict)).not.toContain(idempotencyKey);
    expect(String(conflict)).not.toContain("private-value");
    expect(randomUuid).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("accepts one occurrence for concurrent same-key equivalent payloads", async () => {
    const controlled = createControlledAsyncSchema();
    const changed = signal({
      id: "concurrent.same-payload",
      schema: controlled.schema,
    });
    const delivered = Promise.withResolvers<void>();
    const listener = vi.fn(() => delivered.resolve());
    changed.subscribe(listener);
    const randomUuid = vi.spyOn(globalThis.crypto, "randomUUID");
    const options = { idempotencyKey: "concurrent-provider-event" };

    const firstPublication = changed.publish(
      { attempt: "first", value: "same" },
      options,
    );
    const secondPublication = changed.publish(
      { attempt: "second", value: "same" },
      options,
    );
    await controlled.bothStarted;

    controlled.release("second");
    const original = await secondPublication;
    controlled.release("first");
    const replay = await firstPublication;
    await delivered.promise;
    await flushScheduledListeners();

    expect(replay).toBe(original);
    expect(randomUuid).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ id: original.occurrenceId }),
    );
  });

  it("accepts exactly one concurrent same-key conflicting payload", async () => {
    const controlled = createControlledAsyncSchema();
    const changed = signal({
      id: "concurrent.conflicting-payload",
      schema: controlled.schema,
    });
    const delivered = Promise.withResolvers<void>();
    const listener = vi.fn(() => delivered.resolve());
    changed.subscribe(listener);
    const randomUuid = vi.spyOn(globalThis.crypto, "randomUUID");
    const idempotencyKey = "private-concurrent-provider-key";

    const firstPublication = changed.publish(
      { attempt: "first", value: "private-first-value" },
      { idempotencyKey },
    );
    const secondPublication = changed.publish(
      { attempt: "second", value: "private-second-value" },
      { idempotencyKey },
    );
    const settled = Promise.allSettled([
      firstPublication,
      secondPublication,
    ]);
    await controlled.bothStarted;

    controlled.release("second");
    const accepted = await secondPublication;
    controlled.release("first");
    const [firstResult, secondResult] = await settled;
    await delivered.promise;
    await flushScheduledListeners();

    expect(firstResult).toMatchObject({
      status: "rejected",
      reason: { code: "idempotency_conflict" },
    });
    expect(secondResult).toEqual({ status: "fulfilled", value: accepted });
    const conflict =
      firstResult.status === "rejected" ? firstResult.reason : undefined;
    expect(conflict).toBeInstanceOf(SignalError);
    expect(String(conflict)).not.toContain(idempotencyKey);
    expect(String(conflict)).not.toContain("private-");
    expect(randomUuid).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ id: accepted.occurrenceId }),
    );
  });

  it("snapshots the idempotency key before asynchronous validation", async () => {
    const validationStarted = Promise.withResolvers<void>();
    const releaseValidation = Promise.withResolvers<void>();
    let validationCalls = 0;
    const changed = signal({
      id: "options.snapshot",
      schema: z.object({ value: z.string() }).transform(async (payload) => {
        validationCalls += 1;
        if (validationCalls === 1) {
          validationStarted.resolve();
          await releaseValidation.promise;
        }
        return payload;
      }),
    });
    const listener = vi.fn();
    changed.subscribe(listener);
    const randomUuid = vi.spyOn(globalThis.crypto, "randomUUID");
    const options = { idempotencyKey: "original-key" };

    const publication = changed.publish({ value: "same" }, options);
    await validationStarted.promise;
    options.idempotencyKey = "mutated-key";
    releaseValidation.resolve();
    const original = await publication;
    const replay = await changed.publish(
      { value: "same" },
      { idempotencyKey: "original-key" },
    );
    await flushScheduledListeners();

    expect(replay).toBe(original);
    expect(randomUuid).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("keeps idempotency option access failures payload-safe", async () => {
    const changed = signal({ id: "options.hostile", schema: z.string() });
    const listener = vi.fn();
    changed.subscribe(listener);
    const randomUuid = vi.spyOn(globalThis.crypto, "randomUUID");
    const options = Object.defineProperty({}, "idempotencyKey", {
      get() {
        throw new Error("private-idempotency-option-detail");
      },
    });

    const error = await changed
      .publish("payload", options)
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(SignalError);
    expect(error).toMatchObject({ code: "publication_rejected" });
    expect((error as Error).cause).toBeUndefined();
    expect(String(error)).not.toContain("private-");
    expect(JSON.stringify(error)).not.toContain("private-");
    expect(randomUuid).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });
});

function createControlledAsyncSchema() {
  const started = Promise.withResolvers<void>();
  const barriers = new Map<string, PromiseWithResolvers<void>>();
  const schema = z
    .object({ attempt: z.string(), value: z.string() })
    .transform(async ({ attempt, value }) => {
      const barrier = Promise.withResolvers<void>();
      barriers.set(attempt, barrier);
      if (barriers.size === 2) started.resolve();
      await barrier.promise;
      return { value };
    });

  return {
    schema,
    bothStarted: started.promise,
    release(attempt: string) {
      const barrier = barriers.get(attempt);
      if (barrier === undefined) {
        throw new Error(`Validation attempt \`${attempt}\` has not started.`);
      }
      barrier.resolve();
    },
  };
}

async function flushScheduledListeners(): Promise<void> {
  await new Promise<void>((resolve) => queueMicrotask(resolve));
}
