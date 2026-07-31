import { afterEach, describe, expect, it, vi } from "vitest";
import { signal } from "@use-crux/core";
import { type SignalSchema } from "@use-crux/core/signal";
import { CruxRuntimeError } from "@use-crux/core/runtime";

afterEach(() => vi.restoreAllMocks());

describe("Signal normalized JSON boundary", () => {
  it.each([
    ["sparse array holes", sparseArray],
    ["inherited numeric array properties", arrayWithInheritedIndex],
  ])("rejects %s before acceptance", async (_label, createOutput) => {
    let output = createOutput();
    const changed = signal({
      id: "json.sparse-array",
      schema: outputSchema(() => output),
    });
    const listener = vi.fn();
    changed.subscribe(listener);
    const randomUuid = vi.spyOn(globalThis.crypto, "randomUUID");

    const error = await changed
      .publish({}, { idempotencyKey: "json-array-retry" })
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(CruxRuntimeError);
    expect(error).toMatchObject({ code: "PAYLOAD_NOT_JSON", cause: undefined });
    expect(randomUuid).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();

    output = ["accepted"];
    await expect(
      changed.publish({}, { idempotencyKey: "json-array-retry" }),
    ).resolves.toMatchObject({ signalId: "json.sparse-array" });
    expect(randomUuid).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledOnce();
  });

  it("preserves finite negative zero in accepted normalized output", async () => {
    const changed = signal({
      id: "json.negative-zero",
      schema: outputSchema({ value: -0 }),
    });
    const delivered = Promise.withResolvers<number>();
    changed.subscribe((occurrence) => delivered.resolve(occurrence.payload.value));

    await changed.publish({});

    expect(Object.is(await delivered.promise, -0)).toBe(true);
  });

  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const hostileProxy = new Proxy(
    { retained: true },
    {
      ownKeys() {
        throw new Error("private-proxy-detail");
      },
    },
  );

  it.each([
    ["cycle", cyclic],
    ["non-finite number", { value: Number.NaN }],
    ["undefined array slot", [undefined]],
    ["undefined object property", { value: undefined }],
    ["non-plain object", new Date()],
    ["hostile Proxy", hostileProxy],
  ])("safely rejects %s normalized output", async (label, output) => {
    const changed = signal({
      id: `json.rejected.${label}`,
      schema: outputSchema(output),
    });
    const listener = vi.fn();
    changed.subscribe(listener);
    const randomUuid = vi.spyOn(globalThis.crypto, "randomUUID");

    const error = await changed.publish({}).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(CruxRuntimeError);
    expect(error).toMatchObject({ code: "PAYLOAD_NOT_JSON", cause: undefined });
    expect(String(error)).not.toContain("private-");
    expect(JSON.stringify(error)).not.toContain("private-");
    expect(randomUuid).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });
});

function outputSchema(output: unknown | (() => unknown)): SignalSchema {
  return {
    "~standard": {
      version: 1,
      vendor: "json-boundary-test",
      validate: () => ({
        value: (typeof output === "function" ? output() : output) as never,
      }),
    },
  };
}

function sparseArray(): unknown[] {
  const output = new Array<unknown>(2);
  output[1] = "retained";
  return output;
}

function arrayWithInheritedIndex(): unknown[] {
  const output = new Array<unknown>(1);
  const prototype = Object.create(Array.prototype) as object;
  Object.defineProperty(prototype, "0", { value: "inherited" });
  Object.setPrototypeOf(output, prototype);
  return output;
}
