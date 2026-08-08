/**
 * Stream item/cursor contract validation and terminal error classification.
 */

import { describe, expect, it } from "vitest";

import { MAX_TRANSPORT_BINDING_CURSOR_BYTES } from "../../src/runtime/transport/binding-checkpoint";
import {
  isManagedStreamTerminalError,
  ManagedStreamTerminalError,
  managedStreamTerminalErrorCode,
} from "../../src/runtime/transport/stream-errors";
import {
  validateStreamCursor,
  validateStreamItem,
} from "../../src/runtime/transport/stream-item";

const samplePayload = {
  kind: "inline-base64url" as const,
  value: "YQ",
  byteLength: 1,
  sha256:
    "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb",
};

describe("validateStreamItem / validateStreamCursor", () => {
  it("accepts envelope items with optional cursor", () => {
    const withoutCursor = validateStreamItem({
      kind: "envelope",
      accountId: "acct_1",
      eventId: "evt_1",
      authenticatedRouting: { source: "stream" },
      payload: samplePayload,
    });
    expect(withoutCursor).toEqual({
      kind: "envelope",
      accountId: "acct_1",
      eventId: "evt_1",
      authenticatedRouting: { source: "stream" },
      payload: samplePayload,
    });
    expect("cursor" in withoutCursor).toBe(false);

    const withCursor = validateStreamItem({
      kind: "envelope",
      accountId: "acct_1",
      eventId: "evt_2",
      authenticatedRouting: {},
      payload: samplePayload,
      cursor: "cursor:42",
    });
    expect(withCursor).toMatchObject({
      kind: "envelope",
      cursor: "cursor:42",
    });

    const clearCursor = validateStreamItem({
      kind: "envelope",
      accountId: "acct_1",
      eventId: "evt_3",
      authenticatedRouting: {},
      payload: samplePayload,
      cursor: null,
    });
    expect(clearCursor).toMatchObject({
      kind: "envelope",
      cursor: null,
    });
  });

  it("accepts optional process-local acknowledge on envelope items", () => {
    const acknowledge = async () => undefined;
    const withAck = validateStreamItem({
      kind: "envelope",
      accountId: "acct_1",
      eventId: "evt_ack",
      authenticatedRouting: {},
      payload: samplePayload,
      cursor: "c-ack",
      acknowledge,
    });
    expect(withAck.kind).toBe("envelope");
    if (withAck.kind === "envelope") {
      expect(withAck.acknowledge).toBe(acknowledge);
      expect(withAck.cursor).toBe("c-ack");
    }

    expect(() =>
      validateStreamItem({
        kind: "envelope",
        accountId: "acct_1",
        eventId: "evt_bad_ack",
        authenticatedRouting: {},
        payload: samplePayload,
        acknowledge: "nope",
      }),
    ).toThrow(/acknowledge must be a function/);
  });

  it("accepts cursor-only items including null cursor", () => {
    expect(
      validateStreamItem({
        kind: "cursor",
        cursor: "progress:9",
      }),
    ).toEqual({
      kind: "cursor",
      cursor: "progress:9",
    });

    expect(
      validateStreamItem({
        kind: "cursor",
        cursor: null,
      }),
    ).toEqual({
      kind: "cursor",
      cursor: null,
    });
  });

  it("rejects missing or unknown kind", () => {
    expect(() => validateStreamItem({} as never)).toThrow(
      /TRANSPORT_STREAM_CONTRACT_INVALID|kind/,
    );
    expect(() =>
      validateStreamItem({ kind: "batch", events: [] } as never),
    ).toThrow(/TRANSPORT_STREAM_CONTRACT_INVALID|kind/);
  });

  it("rejects envelope items missing identity fields", () => {
    expect(() =>
      validateStreamItem({
        kind: "envelope",
        accountId: "",
        eventId: "evt_1",
        authenticatedRouting: {},
        payload: samplePayload,
      }),
    ).toThrow(/accountId|TRANSPORT_STREAM_CONTRACT_INVALID/);

    expect(() =>
      validateStreamItem({
        kind: "envelope",
        accountId: "acct_1",
        eventId: "  ",
        authenticatedRouting: {},
        payload: samplePayload,
      }),
    ).toThrow(/eventId|TRANSPORT_STREAM_CONTRACT_INVALID/);
  });

  it("rejects bad cursor bytes and ASCII controls", () => {
    expect(() => validateStreamCursor("")).toThrow();
    expect(() => validateStreamCursor("  padded  ")).toThrow();
    expect(() => validateStreamCursor("has\nnewline")).toThrow();
    expect(() => validateStreamCursor("has\x00null")).toThrow();

    const oversized = "x".repeat(MAX_TRANSPORT_BINDING_CURSOR_BYTES + 1);
    expect(() => validateStreamCursor(oversized)).toThrow(RangeError);

    // null is valid for cursor-only / clear semantics
    expect(validateStreamCursor(null)).toBeNull();
  });

  it("does not accept batched envelopes as one item", () => {
    expect(() =>
      validateStreamItem({
        kind: "envelope",
        events: [
          {
            accountId: "a",
            eventId: "e",
            authenticatedRouting: {},
            payload: samplePayload,
          },
        ],
      } as never),
    ).toThrow();
  });

  it("rejects incomplete payload metadata through the canonical payload union", () => {
    expect(() =>
      validateStreamItem({
        kind: "envelope",
        accountId: "acct_1",
        eventId: "evt_1",
        authenticatedRouting: {},
        payload: { kind: "inline-base64url" },
      }),
    ).toThrow(/TRANSPORT_STREAM_CONTRACT_INVALID|payload/);

    expect(() =>
      validateStreamItem({
        kind: "envelope",
        accountId: "acct_1",
        eventId: "evt_1",
        authenticatedRouting: {},
        payload: {
          kind: "inline-base64url",
          value: "YQ",
          byteLength: 1,
          // missing sha256
        },
      }),
    ).toThrow(/TRANSPORT_STREAM_CONTRACT_INVALID|payload/);

    expect(() =>
      validateStreamItem({
        kind: "envelope",
        accountId: "acct_1",
        eventId: "evt_1",
        authenticatedRouting: {},
        payload: {
          kind: "durable-ref",
          ref: "blob:orders/1",
          byteLength: 1,
          sha256: "not-a-sha",
        },
      }),
    ).toThrow(/TRANSPORT_STREAM_CONTRACT_INVALID|payload/);
  });

  it("rejects invalid nested routing, cycles, and secret-like keys", () => {
    expect(() =>
      validateStreamItem({
        kind: "envelope",
        accountId: "acct_1",
        eventId: "evt_1",
        authenticatedRouting: { nested: { token: "secret" } },
        payload: samplePayload,
      }),
    ).toThrow(/TRANSPORT_STREAM_CONTRACT_INVALID|authenticatedRouting|token/);

    const cyclic: Record<string, unknown> = { source: "stream" };
    cyclic.self = cyclic;
    expect(() =>
      validateStreamItem({
        kind: "envelope",
        accountId: "acct_1",
        eventId: "evt_1",
        authenticatedRouting: cyclic,
        payload: samplePayload,
      }),
    ).toThrow(/TRANSPORT_STREAM_CONTRACT_INVALID|authenticatedRouting|cyclic/);

    expect(() =>
      validateStreamItem({
        kind: "envelope",
        accountId: "acct_1",
        eventId: "evt_1",
        authenticatedRouting: { bad: Number.NaN },
        payload: samplePayload,
      }),
    ).toThrow(/TRANSPORT_STREAM_CONTRACT_INVALID|authenticatedRouting|JSON/);
  });

  it("returns detached immutable payload and routing snapshots", () => {
    const routing: Record<string, unknown> = {
      source: "stream",
      nested: { region: "eu" },
    };
    const payload = {
      kind: "inline-base64url" as const,
      value: samplePayload.value,
      byteLength: samplePayload.byteLength,
      sha256: samplePayload.sha256,
    };

    const validated = validateStreamItem({
      kind: "envelope",
      accountId: "acct_1",
      eventId: "evt_snap",
      authenticatedRouting: routing,
      payload,
      cursor: "cursor:1",
    });

    expect(validated.kind).toBe("envelope");
    if (validated.kind !== "envelope") {
      throw new Error("expected envelope item");
    }

    expect(validated.authenticatedRouting).not.toBe(routing);
    expect(validated.payload).not.toBe(payload);
    expect(Object.isFrozen(validated)).toBe(true);
    expect(Object.isFrozen(validated.authenticatedRouting)).toBe(true);
    expect(Object.isFrozen(validated.payload)).toBe(true);

    routing.source = "mutated";
    (routing.nested as { region: string }).region = "us";
    payload.value = "mutated";

    expect(validated.authenticatedRouting).toEqual({
      source: "stream",
      nested: { region: "eu" },
    });
    expect(validated.payload).toEqual(samplePayload);
  });
});

describe("ManagedStreamTerminalError classification", () => {
  it("constructs with terminal flag and safe code", () => {
    const error = new ManagedStreamTerminalError(
      "AUTH_REVOKED",
      "credentials revoked",
    );
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ManagedStreamTerminalError");
    expect(error.terminal).toBe(true);
    expect(error.code).toBe("AUTH_REVOKED");
    expect(error.message).toBe("credentials revoked");
    expect(isManagedStreamTerminalError(error)).toBe(true);
    expect(managedStreamTerminalErrorCode(error)).toBe("AUTH_REVOKED");
  });

  it("classifies duck-typed { terminal: true, code } shapes", () => {
    const duck = { terminal: true as const, code: "PROVIDER_GONE" };
    expect(isManagedStreamTerminalError(duck)).toBe(true);
    expect(managedStreamTerminalErrorCode(duck)).toBe("PROVIDER_GONE");
  });

  it("maps unsafe or missing codes to TRANSPORT_STREAM_TERMINAL", () => {
    expect(
      managedStreamTerminalErrorCode(
        new ManagedStreamTerminalError("not a safe code!"),
      ),
    ).toBe("TRANSPORT_STREAM_TERMINAL");

    expect(
      managedStreamTerminalErrorCode({
        terminal: true,
        code: "has spaces",
      }),
    ).toBe("TRANSPORT_STREAM_TERMINAL");

    expect(
      managedStreamTerminalErrorCode({
        terminal: true,
        code: "",
      }),
    ).toBe("TRANSPORT_STREAM_TERMINAL");

    // Unsafe constructor still produces a terminal error object.
    const unsafe = new ManagedStreamTerminalError("bad code");
    expect(isManagedStreamTerminalError(unsafe)).toBe(true);
    expect(managedStreamTerminalErrorCode(unsafe)).toBe(
      "TRANSPORT_STREAM_TERMINAL",
    );
  });

  it("does not treat AbortError as terminal", () => {
    const abort = new DOMException("aborted", "AbortError");
    expect(isManagedStreamTerminalError(abort)).toBe(false);
    expect(managedStreamTerminalErrorCode(abort)).toBeUndefined();

    const named = new Error("aborted");
    named.name = "AbortError";
    expect(isManagedStreamTerminalError(named)).toBe(false);

    expect(
      isManagedStreamTerminalError(new Error("plain failure")),
    ).toBe(false);
    expect(
      isManagedStreamTerminalError({ terminal: false, code: "X" }),
    ).toBe(false);
    expect(
      isManagedStreamTerminalError({ terminal: true, code: 42 }),
    ).toBe(false);
  });
});
