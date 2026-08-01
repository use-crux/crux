import { afterEach, describe, expect, it } from "vitest";
import { config, flow, signal } from "@use-crux/core";
import type { SignalOccurrence } from "@use-crux/core/signal";
import { node } from "@use-crux/core/runtime";
import { resetHooks } from "../src/runtime/runtime";
import { durableMemoryRuntimeStore } from "./signal-durable-test-helpers";
import { z } from "zod";

afterEach(resetHooks);

describe("Signal Date ownership", () => {
  it("gives the receipt and each listener distinct acceptedAt values", async () => {
    const changed = signal({ id: "date.changed", schema: z.string() });
    const first = Promise.withResolvers<SignalOccurrence>();
    const second = Promise.withResolvers<SignalOccurrence>();
    changed.subscribe(first.resolve);
    changed.subscribe(second.resolve);

    const receipt = await changed.publish("accepted");
    const firstOccurrence = await first.promise;
    const secondOccurrence = await second.promise;
    const acceptedAt = receipt.acceptedAt.getTime();

    expect(firstOccurrence.acceptedAt).not.toBe(receipt.acceptedAt);
    expect(secondOccurrence.acceptedAt).not.toBe(receipt.acceptedAt);
    expect(secondOccurrence.acceptedAt).not.toBe(firstOccurrence.acceptedAt);

    receipt.acceptedAt.setTime(0);
    firstOccurrence.acceptedAt.setTime(1);
    expect(secondOccurrence.acceptedAt.getTime()).toBe(acceptedAt);
  });

  it("isolates durable record, receipt, and listener timestamps", async () => {
    const store = durableMemoryRuntimeStore();
    const crux = config({
      runtime: node({
        store,
        namespace: "signal-date-ownership-test",
        autoStartMaintenance: false,
      }),
    });
    const changed = signal({ id: "date.durable", schema: z.string() });
    const delivered = Promise.withResolvers<SignalOccurrence>();
    changed.subscribe(delivered.resolve);
    const consumer = flow(
      "date ownership consumer",
      { signals: { changed } },
      async (scope) => {
        await scope.waitFor(changed);
      },
    );

    try {
      await consumer.run({ flowId: "flow_signal_date_ownership" });
      const receipt = await changed.publish("accepted");
      const occurrence = await delivered.promise;
      const record = await store.signals.getOccurrence(
        "signal-date-ownership-test",
        receipt.occurrenceId,
      );
      const acceptedAt = record?.acceptedAt;

      expect(occurrence.acceptedAt).not.toBe(receipt.acceptedAt);
      receipt.acceptedAt.setTime(0);
      occurrence.acceptedAt.setTime(1);
      await expect(
        store.signals.getOccurrence(
          "signal-date-ownership-test",
          receipt.occurrenceId,
        ),
      ).resolves.toMatchObject({ acceptedAt });
    } finally {
      crux.dispose();
    }
  });
});
