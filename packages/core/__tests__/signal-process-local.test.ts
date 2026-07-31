import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { signal } from "@use-crux/core";
import {
  SignalError,
  SignalValidationError,
  type SignalOccurrence,
  type SignalSchema,
} from "@use-crux/core/signal";
import { CruxRuntimeError } from "@use-crux/core/runtime";

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

  it("rejects schema-invalid payloads before allocating an occurrence", async () => {
    const quantityChanged = signal({
      id: "quantity.changed",
      schema: z.object({ quantity: z.number().int().positive() }),
    });
    const listener = vi.fn();
    quantityChanged.subscribe(listener);
    const randomUuid = vi.spyOn(globalThis.crypto, "randomUUID");

    await expect(quantityChanged.publish({ quantity: -1 })).rejects.toBeInstanceOf(
      SignalValidationError,
    );

    expect(randomUuid).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  it("keeps schema issue diagnostics free of rejected payload values", async () => {
    const privateValue = "private-customer-payload";
    const rejectingSchema: SignalSchema = {
      "~standard": {
        version: 1,
        vendor: "privacy-test",
        validate: () => ({
          issues: [
            {
              message: `Rejected value: ${privateValue}`,
              path: ["customerToken"],
            },
          ],
        }),
      },
    };
    const rejected = signal({
      id: "private.rejected",
      schema: rejectingSchema,
    });

    const error = await rejected.publish(privateValue).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(SignalValidationError);
    expect(JSON.stringify(error)).not.toContain(privateValue);
  });

  it("rejects JSON-unsafe normalized output before acceptance", async () => {
    const privateField = "privateCustomerField";
    const unsafeSchema: SignalSchema = {
      "~standard": {
        version: 1,
        vendor: "unsafe-test",
        validate: () => ({ value: { [privateField]: new Date() } as never }),
      },
    };
    const unsafeSignal = signal({
      id: "unsafe.normalized",
      schema: unsafeSchema,
    });
    const listener = vi.fn();
    unsafeSignal.subscribe(listener);
    const randomUuid = vi.spyOn(globalThis.crypto, "randomUUID");

    const publication = unsafeSignal.publish({});
    await expect(publication).rejects.toMatchObject({
      code: "PAYLOAD_NOT_JSON",
    });
    await expect(publication).rejects.toBeInstanceOf(CruxRuntimeError);
    await expect(publication).rejects.not.toThrow(privateField);
    expect(randomUuid).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  it("wraps schema execution failures without exposing private details", async () => {
    const privateDetail = "private-schema-provider-detail";
    const failingSchema: SignalSchema = {
      "~standard": {
        version: 1,
        vendor: "failing-test",
        validate: () => {
          throw new Error(privateDetail);
        },
      },
    };
    const rejected = signal({ id: "schema.rejected", schema: failingSchema });
    const randomUuid = vi.spyOn(globalThis.crypto, "randomUUID");

    const error = await rejected.publish({}).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(SignalError);
    expect(error).toMatchObject({ code: "publication_rejected" });
    expect(String(error)).not.toContain(privateDetail);
    expect(randomUuid).not.toHaveBeenCalled();
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
    await new Promise<void>((resolve) => queueMicrotask(resolve));

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
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    expect(conflict).toBeInstanceOf(SignalError);
    expect(conflict).toMatchObject({ code: "idempotency_conflict" });
    expect(String(conflict)).not.toContain(idempotencyKey);
    expect(String(conflict)).not.toContain("private-value");
    expect(randomUuid).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
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

  it("creates frozen inert predicate and match identities", () => {
    const changed = signal({
      id: "account.changed",
      schema: z.object({ account: z.object({ id: z.string() }) }),
    });
    const predicate = (payload: { account: { id: string } }) =>
      payload.account.id === "account_123";
    const authoredMatch = { account: { id: "account_123" } };

    const predicateView = changed.when(predicate);
    const matchView = changed.when(authoredMatch);
    authoredMatch.account.id = "mutated";

    expect(predicateView).toEqual({
      _tag: "FilteredSignal",
      filterKind: "predicate",
      signal: changed,
      predicate,
    });
    expect(matchView.match).toEqual({ account: { id: "account_123" } });
    expect(Object.isFrozen(predicateView)).toBe(true);
    expect(Object.isFrozen(matchView)).toBe(true);
    expect(Object.isFrozen(matchView.match.account)).toBe(true);
    expect("publish" in matchView).toBe(false);
    expect("subscribe" in matchView).toBe(false);
    expect("when" in matchView).toBe(false);
  });
});
