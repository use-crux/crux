/**
 * Pure SSE → StreamItem lowering and open wrapper contract.
 */

import { describe, expect, it, vi } from "vitest";

import { MAX_TRANSPORT_BINDING_CURSOR_BYTES } from "../../src/runtime/transport/binding-checkpoint";
import { lowerSseItem, lowerSseOpen } from "../../src/signal/transport/sse-lower";
import type { SseItem, SseOpen, StreamOpenContext } from "../../src/signal/transport";

const samplePayload = {
  kind: "inline-base64url" as const,
  value: "YQ",
  byteLength: 1,
  sha256:
    "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb",
};

const sampleContext: StreamOpenContext = {
  cursor: null,
  signal: new AbortController().signal,
  configRef: { id: "config.sse", revision: "rev.1" },
};

describe("lowerSseItem", () => {
  it("maps envelope lastEventId to cursor", () => {
    const lowered = lowerSseItem({
      kind: "envelope",
      accountId: "acct_1",
      eventId: "evt_1",
      authenticatedRouting: { source: "sse" },
      payload: samplePayload,
      lastEventId: "id:42",
    });

    expect(lowered).toEqual({
      kind: "envelope",
      accountId: "acct_1",
      eventId: "evt_1",
      authenticatedRouting: { source: "sse" },
      payload: samplePayload,
      cursor: "id:42",
    });
  });

  it("omits cursor when lastEventId is omitted", () => {
    const lowered = lowerSseItem({
      kind: "envelope",
      accountId: "acct_1",
      eventId: "evt_2",
      authenticatedRouting: { source: "sse" },
      payload: samplePayload,
    });

    expect(lowered).toEqual({
      kind: "envelope",
      accountId: "acct_1",
      eventId: "evt_2",
      authenticatedRouting: { source: "sse" },
      payload: samplePayload,
    });
    expect("cursor" in lowered).toBe(false);
  });

  it("maps null lastEventId to cursor: null", () => {
    const lowered = lowerSseItem({
      kind: "envelope",
      accountId: "acct_1",
      eventId: "evt_3",
      authenticatedRouting: {},
      payload: samplePayload,
      lastEventId: null,
    });

    expect(lowered).toMatchObject({
      kind: "envelope",
      cursor: null,
    });
  });

  it("maps cursor-only lastEventId to StreamCursorItem", () => {
    expect(
      lowerSseItem({
        kind: "cursor",
        lastEventId: "hb:9",
      }),
    ).toEqual({
      kind: "cursor",
      cursor: "hb:9",
    });

    expect(
      lowerSseItem({
        kind: "cursor",
        lastEventId: null,
      }),
    ).toEqual({
      kind: "cursor",
      cursor: null,
    });
  });

  it("rejects oversized, control, and empty lastEventId via canonical cursor contract", () => {
    const baseEnvelope = {
      kind: "envelope" as const,
      accountId: "acct_1",
      eventId: "evt_1",
      authenticatedRouting: {},
      payload: samplePayload,
    };

    expect(() =>
      lowerSseItem({ ...baseEnvelope, lastEventId: "" }),
    ).toThrow(/TRANSPORT_STREAM_CONTRACT_INVALID|cursor/);

    expect(() =>
      lowerSseItem({ ...baseEnvelope, lastEventId: "  padded  " }),
    ).toThrow(/TRANSPORT_STREAM_CONTRACT_INVALID|cursor/);

    expect(() =>
      lowerSseItem({ ...baseEnvelope, lastEventId: "has\nnewline" }),
    ).toThrow(/TRANSPORT_STREAM_CONTRACT_INVALID|cursor/);

    expect(() =>
      lowerSseItem({ ...baseEnvelope, lastEventId: "has\x00null" }),
    ).toThrow(/TRANSPORT_STREAM_CONTRACT_INVALID|cursor/);

    const oversized = "x".repeat(MAX_TRANSPORT_BINDING_CURSOR_BYTES + 1);
    expect(() =>
      lowerSseItem({ ...baseEnvelope, lastEventId: oversized }),
    ).toThrow(RangeError);

    expect(() =>
      lowerSseItem({ kind: "cursor", lastEventId: "" }),
    ).toThrow(/TRANSPORT_STREAM_CONTRACT_INVALID|cursor/);
  });

  it("rejects batches, arrays, and bad kind", () => {
    expect(() => lowerSseItem([{ kind: "cursor", lastEventId: "a" }] as never)).toThrow(
      /TRANSPORT_STREAM_CONTRACT_INVALID|batch|object/,
    );

    expect(() =>
      lowerSseItem({
        kind: "batch",
        events: [],
      } as never),
    ).toThrow(/TRANSPORT_STREAM_CONTRACT_INVALID|kind/);

    expect(() => lowerSseItem({} as never)).toThrow(
      /TRANSPORT_STREAM_CONTRACT_INVALID|kind/,
    );

    expect(() => lowerSseItem(null as never)).toThrow(
      /TRANSPORT_STREAM_CONTRACT_INVALID/,
    );
  });

  it("returns detached immutable payload and routing through stream validator", () => {
    const routing: Record<string, unknown> = {
      source: "sse",
      nested: { region: "eu" },
    };
    const payload = {
      kind: "inline-base64url" as const,
      value: samplePayload.value,
      byteLength: samplePayload.byteLength,
      sha256: samplePayload.sha256,
    };

    const lowered = lowerSseItem({
      kind: "envelope",
      accountId: "acct_1",
      eventId: "evt_snap",
      authenticatedRouting: routing,
      payload,
      lastEventId: "id:1",
    });

    expect(Object.isFrozen(lowered)).toBe(true);
    expect(lowered.kind).toBe("envelope");
    if (lowered.kind !== "envelope") {
      throw new Error("expected envelope");
    }

    routing.source = "mutated";
    (routing.nested as { region: string }).region = "us";
    payload.value = "mutated";

    expect(lowered.authenticatedRouting).toEqual({
      source: "sse",
      nested: { region: "eu" },
    });
    expect(lowered.payload).toEqual(samplePayload);
  });
});

describe("lowerSseOpen", () => {
  it("lowers each yielded item under pull backpressure", async () => {
    const open: SseOpen = async function* () {
      yield {
        kind: "envelope",
        accountId: "acct_1",
        eventId: "evt_1",
        authenticatedRouting: { source: "sse" },
        payload: samplePayload,
        lastEventId: "id:1",
      } satisfies SseItem;
      yield { kind: "cursor", lastEventId: "id:2" } satisfies SseItem;
    };

    const loweredOpen = lowerSseOpen(open);
    const items: unknown[] = [];
    for await (const item of await loweredOpen(sampleContext)) {
      items.push(item);
    }

    expect(items).toEqual([
      {
        kind: "envelope",
        accountId: "acct_1",
        eventId: "evt_1",
        authenticatedRouting: { source: "sse" },
        payload: samplePayload,
        cursor: "id:1",
      },
      {
        kind: "cursor",
        cursor: "id:2",
      },
    ]);
  });

  it("awaits Promise<AsyncIterable> open results", async () => {
    const open: SseOpen = async () => {
      return (async function* () {
        yield { kind: "cursor" as const, lastEventId: "from-promise" };
      })();
    };

    const loweredOpen = lowerSseOpen(open);
    const iterable = await loweredOpen(sampleContext);
    const items: unknown[] = [];
    for await (const item of iterable) {
      items.push(item);
    }

    expect(items).toEqual([{ kind: "cursor", cursor: "from-promise" }]);
  });

  it("honors iterator return cleanup on early stop", async () => {
    const returnSpy = vi.fn(async () => undefined);
    const open: SseOpen = () => ({
      [Symbol.asyncIterator]() {
        let done = false;
        return {
          async next() {
            if (done) {
              return { done: true as const, value: undefined };
            }
            done = true;
            return {
              done: false as const,
              value: {
                kind: "cursor" as const,
                lastEventId: "id:early",
              },
            };
          },
          return: returnSpy,
        };
      },
    });

    const loweredOpen = lowerSseOpen(open);
    const iterable = await loweredOpen(sampleContext);
    const iterator = iterable[Symbol.asyncIterator]();

    const first = await iterator.next();
    expect(first.done).toBe(false);
    expect(first.value).toEqual({ kind: "cursor", cursor: "id:early" });

    await iterator.return?.();
    expect(returnSpy).toHaveBeenCalledTimes(1);
  });
});
