import { describe, expect, it } from "vitest";

import {
  RuntimeManagedTransportContractError,
  validateRuntimeAcceptedTransportEnvelope,
  validateRuntimeManagedTransportAdapterDeclaration,
  validateRuntimeManagedTransportBinding,
} from "../../src/runtime/public";

const digest = "a".repeat(64);

function adapter() {
  return {
    _tag: "RuntimeManagedTransportAdapter",
    id: "adapter.webhook",
    provider: "example",
    acceptedEnvelopeVersion: 1,
  };
}

function binding() {
  return {
    _tag: "RuntimeManagedTransportBinding",
    id: "binding.primary",
    adapter: adapter(),
    configRef: { id: "config.transport", revision: "revision.1" },
    target: { kind: "signal", signalId: "orders.received" },
  };
}

function envelope() {
  return {
    _tag: "RuntimeAcceptedTransportEnvelope",
    schemaVersion: 1,
    bindingId: "binding.primary",
    adapterId: "adapter.webhook",
    provider: "example",
    accountId: "account.primary",
    eventId: "event.1",
    receivedAt: "2026-08-02T12:00:00.000Z",
    authenticatedRouting: { region: "eu", selectors: ["paid"] },
    payload: {
      kind: "inline-base64url",
      value: "AQID",
      byteLength: 3,
      sha256: digest,
    },
    configRef: { id: "config.transport", revision: "revision.1" },
    target: { kind: "signal", signalId: "orders.received" },
  };
}

function expectContractError(run: () => unknown) {
  expect(run).toThrow(RuntimeManagedTransportContractError);
  try {
    run();
  } catch (error) {
    expect(error).toMatchObject({
      code: "RUNTIME_MANAGED_TRANSPORT_CONTRACT_INVALID",
      path: expect.any(String),
    });
  }
}

describe("runtime managed transport validation", () => {
  it("accepts, detaches, and deeply freezes declarations", () => {
    const input = binding();
    const validated = validateRuntimeManagedTransportBinding(input);

    input.adapter.id = "adapter.changed";
    input.target.signalId = "orders.changed";

    expect(validated).toMatchObject({
      id: "binding.primary",
      adapter: { id: "adapter.webhook" },
      target: { signalId: "orders.received" },
    });
    expect(validated).not.toBe(input);
    expect(Object.isFrozen(validated)).toBe(true);
    expect(Object.isFrozen(validated.adapter)).toBe(true);
    expect(Object.isFrozen(validated.target)).toBe(true);
  });

  it("accepts both detached payload forms", () => {
    const inline = validateRuntimeAcceptedTransportEnvelope(envelope());
    const durable = validateRuntimeAcceptedTransportEnvelope({
      ...envelope(),
      payload: {
        kind: "durable-ref",
        ref: "s3://example-bucket/events/event-1",
        byteLength: 3,
        sha256: digest,
      },
    });

    expect(inline.payload).toMatchObject({ kind: "inline-base64url", byteLength: 3 });
    expect(durable.payload).toMatchObject({ kind: "durable-ref", byteLength: 3 });
    expect(Object.isFrozen(inline.authenticatedRouting)).toBe(true);
  });

  it("rejects unknown keys at declaration and envelope levels", () => {
    expectContractError(() =>
      validateRuntimeManagedTransportAdapterDeclaration({ ...adapter(), extra: true }),
    );
    expectContractError(() =>
      validateRuntimeManagedTransportBinding({ ...binding(), extra: true }),
    );
    expectContractError(() =>
      validateRuntimeManagedTransportBinding({
        ...binding(),
        configRef: { ...binding().configRef, extra: true },
      }),
    );
    expectContractError(() =>
      validateRuntimeManagedTransportBinding({
        ...binding(),
        target: { ...binding().target, extra: true },
      }),
    );
    expectContractError(() =>
      validateRuntimeAcceptedTransportEnvelope({ ...envelope(), extra: true }),
    );
    expectContractError(() =>
      validateRuntimeAcceptedTransportEnvelope({
        ...envelope(),
        payload: { ...envelope().payload, extra: true },
      }),
    );
  });

  it("rejects live, non-plain, accessor, and cyclic values", () => {
    const withAccessor = adapter();
    Object.defineProperty(withAccessor, "id", {
      enumerable: true,
      get: () => "adapter.webhook",
    });
    const cyclic = envelope();
    const routing: Record<string, unknown> = cyclic.authenticatedRouting;
    routing.self = routing;

    const invalidValues: unknown[] = [
      () => undefined,
      Symbol("live"),
      1n,
      new (class Client {})(),
      new Date(),
      new Request("https://example.test"),
      new Response(),
      new Headers(),
      new AbortController().signal,
      new Uint8Array(),
      Promise.resolve(),
      new Map(),
      new Set(),
    ];

    for (const value of invalidValues) {
      expectContractError(() =>
        validateRuntimeManagedTransportAdapterDeclaration({ ...adapter(), provider: value }),
      );
    }
    expectContractError(() => validateRuntimeManagedTransportAdapterDeclaration(withAccessor));
    expectContractError(() => validateRuntimeAcceptedTransportEnvelope(cyclic));
  });

  it("rejects malformed identifiers and timestamps", () => {
    for (const id of ["", " adapter", "adapter ", "adapter\n", "a".repeat(513)]) {
      expectContractError(() =>
        validateRuntimeManagedTransportAdapterDeclaration({ ...adapter(), id }),
      );
    }
    expectContractError(() =>
      validateRuntimeAcceptedTransportEnvelope({
        ...envelope(),
        receivedAt: "2026-08-02T14:00:00+02:00",
      }),
    );
    expectContractError(() =>
      validateRuntimeAcceptedTransportEnvelope({
        ...envelope(),
        receivedAt: "2026-08-02T12:00:00Z",
      }),
    );
  });

  it("rejects invalid digests, byte lengths, base64url, and oversized inline payloads", () => {
    expectContractError(() =>
      validateRuntimeAcceptedTransportEnvelope({
        ...envelope(),
        payload: { ...envelope().payload, sha256: "A".repeat(64) },
      }),
    );
    expectContractError(() =>
      validateRuntimeAcceptedTransportEnvelope({
        ...envelope(),
        payload: { ...envelope().payload, byteLength: 2 },
      }),
    );
    expectContractError(() =>
      validateRuntimeAcceptedTransportEnvelope({
        ...envelope(),
        payload: { ...envelope().payload, value: "AQI=" },
      }),
    );
    expect(() =>
      validateRuntimeAcceptedTransportEnvelope({
        ...envelope(),
        payload: {
          ...envelope().payload,
          value: "!".repeat(Math.ceil((1024 * 1024 * 4) / 3) + 1),
        },
      }),
    ).toThrow("$.payload.value: must not exceed encoded length for 1 MiB of decoded bytes");
    const inlineByteLength = 1_048_578;
    expectContractError(() =>
      validateRuntimeAcceptedTransportEnvelope({
        ...envelope(),
        payload: {
          ...envelope().payload,
          value: "A".repeat((inlineByteLength / 3) * 4),
          byteLength: inlineByteLength,
        },
      }),
    );
  });

  it("rejects invalid durable references and oversized or secret-bearing routing", () => {
    expectContractError(() =>
      validateRuntimeAcceptedTransportEnvelope({
        ...envelope(),
        payload: {
          kind: "durable-ref",
          ref: "https://user:password@example.test/event",
          byteLength: 3,
          sha256: digest,
        },
      }),
    );
    for (const key of ["authorization", "COOKIE", "Signature", "apiToken", "x-signature"]) {
      expectContractError(() =>
        validateRuntimeAcceptedTransportEnvelope({
          ...envelope(),
          authenticatedRouting: { [key]: "secret" },
        }),
      );
    }
    expectContractError(() =>
      validateRuntimeAcceptedTransportEnvelope({
        ...envelope(),
        authenticatedRouting: { nested: { token: "secret" } },
      }),
    );
    expectContractError(() =>
      validateRuntimeAcceptedTransportEnvelope({
        ...envelope(),
        authenticatedRouting: { route: "x".repeat(16 * 1024) },
      }),
    );
  });

  it("rejects routing deeper than the traversal budget", () => {
    let routing: Record<string, unknown> = {};
    for (let depth = 0; depth < 65; depth += 1) routing = { child: routing };

    expect(() =>
      validateRuntimeAcceptedTransportEnvelope({
        ...envelope(),
        authenticatedRouting: routing,
      }),
    ).toThrow("must not exceed routing depth limit of 64");
  });

  it("rejects routing wider than the traversal budget", () => {
    expect(() =>
      validateRuntimeAcceptedTransportEnvelope({
        ...envelope(),
        authenticatedRouting: { items: Array.from({ length: 1024 }, () => null) },
      }),
    ).toThrow("must not exceed routing node limit of 1024");
  });
});
