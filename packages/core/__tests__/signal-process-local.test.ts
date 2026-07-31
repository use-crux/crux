import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { signal } from "@use-crux/core";
import type { SignalOccurrence } from "@use-crux/core/signal";

afterEach(() => vi.restoreAllMocks());

describe("process-local Signal publication", () => {
  it("keeps definition inert and delivers normalized schema output", async () => {
    let validationCalls = 0;
    const schema = z
      .object({ count: z.string() })
      .transform(({ count }) => {
        validationCalls += 1;
        return { count: Number(count), normalized: true as const };
      });
    const counterChanged = signal({ id: "counter.changed", schema });
    expect(validationCalls).toBe(0);
    expect(Object.isFrozen(counterChanged)).toBe(true);

    const delivered = Promise.withResolvers<
      SignalOccurrence<"counter.changed", { count: number; normalized: true }>
    >();
    const unsubscribe = counterChanged.subscribe(delivered.resolve);
    const receipt = await counterChanged.publish({ count: "2" });
    const occurrence = await delivered.promise;

    expect(validationCalls).toBe(1);
    expect(occurrence).toMatchObject({
      id: receipt.occurrenceId,
      signalId: "counter.changed",
      payload: { count: 2, normalized: true },
      acceptedAt: receipt.acceptedAt,
    });
    unsubscribe();
  });

  it("reports the honest process-local acceptance receipt", async () => {
    const refreshed = signal({ id: "cache.refreshed", schema: z.string() });

    const receipt = await refreshed.publish("products");
    expect(receipt).toEqual({
      occurrenceId: expect.stringMatching(/^signal_occurrence_/),
      signalId: "cache.refreshed",
      acceptedAt: expect.any(Date),
      guarantee: "process-local",
    });
    expect(Object.isFrozen(receipt)).toBe(true);
  });

  it("delivers a detached and deeply immutable normalized payload", async () => {
    const normalized = {
      account: { id: "account_123" },
      labels: [{ value: "original" }],
    };
    const changed = signal({
      id: "account.normalized",
      schema: z.unknown().transform(() => normalized),
    });
    const delivered = Promise.withResolvers<
      SignalOccurrence<"account.normalized", typeof normalized>
    >();
    changed.subscribe(delivered.resolve);

    await changed.publish({});
    normalized.account.id = "mutated";
    normalized.labels[0]!.value = "mutated";
    const occurrence = await delivered.promise;

    expect(occurrence.payload).toEqual({
      account: { id: "account_123" },
      labels: [{ value: "original" }],
    });
    expect(Object.isFrozen(occurrence.payload)).toBe(true);
    expect(Object.isFrozen(occurrence.payload.account)).toBe(true);
    expect(Object.isFrozen(occurrence.payload.labels)).toBe(true);
    expect(Object.isFrozen(occurrence.payload.labels[0])).toBe(true);
    expect(() => {
      occurrence.payload.account.id = "second-mutation";
    }).toThrow(TypeError);
  });

  it("unsubscribes idempotently", async () => {
    const updated = signal({ id: "profile.updated", schema: z.string() });
    const listener = vi.fn();
    const unsubscribe = updated.subscribe(listener);

    unsubscribe();
    unsubscribe();
    await updated.publish("profile_123");
    expect(listener).not.toHaveBeenCalled();
  });

  it("does not replay historical occurrences to later subscriptions", async () => {
    const updated = signal({ id: "inventory.updated", schema: z.number() });
    await updated.publish(1);
    const delivered =
      Promise.withResolvers<SignalOccurrence<"inventory.updated", number>>();

    updated.subscribe(delivered.resolve);
    await updated.publish(2);
    await expect(delivered.promise).resolves.toMatchObject({ payload: 2 });
  });

  it("isolates listener failures without unhandled rejections", async () => {
    const completed = signal({ id: "job.completed", schema: z.string() });
    const safeListener = vi.fn();
    const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});
    const unhandledRejection = vi.fn();
    process.on("unhandledRejection", unhandledRejection);
    completed.subscribe(() => {
      throw new Error("private-sync-listener-detail");
    });
    completed.subscribe(async () => {
      await Promise.resolve();
      throw new Error("private-async-listener-detail");
    });
    completed.subscribe(safeListener);

    try {
      const receipt = await completed.publish("job_123");
      await Promise.resolve();
      await Promise.resolve();

      expect(receipt.guarantee).toBe("process-local");
      expect(safeListener).toHaveBeenCalledTimes(1);
      expect(diagnostic).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(diagnostic.mock.calls)).not.toContain("private-");
      expect(unhandledRejection).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandledRejection);
    }
  });

  it("resolves publication while an asynchronous listener is still pending", async () => {
    const queued = signal({ id: "report.queued", schema: z.string() });
    const listenerStarted = Promise.withResolvers<void>();
    const listenerCompletion = Promise.withResolvers<void>();
    queued.subscribe(async () => {
      listenerStarted.resolve();
      await listenerCompletion.promise;
    });

    const receipt = await queued.publish("report_123");
    await listenerStarted.promise;

    expect(receipt.guarantee).toBe("process-local");
    listenerCompletion.resolve();
  });
});
