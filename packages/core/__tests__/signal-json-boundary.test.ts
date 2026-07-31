import { afterEach, describe, expect, it, vi } from "vitest";
import { signal } from "@use-crux/core";
import { type SignalSchema } from "@use-crux/core/signal";
import { CruxRuntimeError } from "@use-crux/core/runtime";

afterEach(() => vi.restoreAllMocks());

describe("Signal normalized JSON boundary", () => {
  it("clones sparse array slots as null", async () => {
    const sparse = new Array<unknown>(2);
    sparse[1] = "retained";
    const changed = signal({
      id: "json.sparse-array",
      schema: outputSchema(sparse),
    });
    const delivered = Promise.withResolvers<unknown>();
    changed.subscribe((occurrence) => delivered.resolve(occurrence.payload));

    await changed.publish({});

    await expect(delivered.promise).resolves.toEqual([null, "retained"]);
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

function outputSchema(output: unknown): SignalSchema {
  return {
    "~standard": {
      version: 1,
      vendor: "json-boundary-test",
      validate: () => ({ value: output as never }),
    },
  };
}
