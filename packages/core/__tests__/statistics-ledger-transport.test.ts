import { describe, expect, it } from "vitest";

import {
  createMemoryStatisticsLedger,
  type StatisticsOwner,
} from "../src/statistics";
import { transportStatisticsIdentity } from "../src/runtime/transport";

describe("statistics ledger transport envelopes", () => {
  it("accumulates bounded transport outcomes with adapter identity attribution", () => {
    const ledger = createMemoryStatisticsLedger();
    const owner = {
      kind: "transport",
      id: "ns.orders",
    } satisfies StatisticsOwner;
    const ordersIdentity = transportStatisticsIdentity(
      "adapter.orders",
      "binding.orders",
    );
    const otherIdentity = transportStatisticsIdentity(
      "adapter.other",
      "binding.other",
    );
    let cursor = 0;
    const at = (offset: number) => new Date(1_800_100_000_000 + offset);
    const record = (
      fact: {
        readonly kind: "transport-envelope";
        readonly identity: string;
        readonly outcome:
          | "accepted"
          | "deduplicated"
          | "normalized"
          | "delivered"
          | "retried"
          | "dead-lettered";
      },
      offset: number,
    ) => {
      cursor += 1;
      ledger.record({ owner, cursor, at: at(offset), fact });
    };

    record(
      {
        kind: "transport-envelope",
        identity: ordersIdentity,
        outcome: "accepted",
      },
      1,
    );
    record(
      {
        kind: "transport-envelope",
        identity: ordersIdentity,
        outcome: "deduplicated",
      },
      2,
    );
    record(
      {
        kind: "transport-envelope",
        identity: ordersIdentity,
        outcome: "retried",
      },
      3,
    );
    record(
      {
        kind: "transport-envelope",
        identity: ordersIdentity,
        outcome: "normalized",
      },
      4,
    );
    record(
      {
        kind: "transport-envelope",
        identity: ordersIdentity,
        outcome: "delivered",
      },
      5,
    );
    record(
      {
        kind: "transport-envelope",
        identity: otherIdentity,
        outcome: "accepted",
      },
      6,
    );
    record(
      {
        kind: "transport-envelope",
        identity: otherIdentity,
        outcome: "dead-lettered",
      },
      7,
    );

    const scope = ledger.snapshot(owner)!.scope;
    expect(scope.transport.total).toEqual({
      accepted: 2,
      deduplicated: 1,
      normalized: 1,
      delivered: 1,
      retried: 1,
      deadLettered: 1,
    });
    expect(scope.transport.byIdentity[ordersIdentity]).toEqual({
      accepted: 1,
      deduplicated: 1,
      normalized: 1,
      delivered: 1,
      retried: 1,
      deadLettered: 0,
    });
    expect(scope.transport.identityAttribution).toBe("complete");
  });

  it("rolls transport identities beyond 64 into overflow without losing totals", () => {
    const ledger = createMemoryStatisticsLedger();
    const owner = { kind: "transport", id: "ns.bound" } satisfies StatisticsOwner;
    let cursor = 0;
    for (let index = 0; index < 65; index += 1) {
      cursor += 1;
      ledger.record({
        owner,
        cursor,
        at: new Date(1_800_200_000_000 + cursor),
        fact: {
          kind: "transport-envelope",
          identity: `binding-${index}`,
          outcome: "accepted",
        },
      });
    }

    const scope = ledger.snapshot(owner)!.scope;
    expect(Object.keys(scope.transport.byIdentity)).toHaveLength(64);
    expect(scope.transport.total.accepted).toBe(65);
    expect(scope.transport.otherIdentities?.accepted).toBe(1);
    expect(scope.transport.identityAttribution).toBe("truncated");
  });
});
