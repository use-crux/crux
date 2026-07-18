import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { RUNTIME_RESULT_MAX_BYTES } from "@use-crux/core/runtime";
import { canonicalRuntimeResult } from "@use-crux/core/runtime/internal/eval-host";
import { createCloudflareResultPort } from "../../src/runtime/results";
import { asStoragePort } from "../../src/runtime/storage";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    CRUX_EVAL_HOST: DurableObjectNamespace;
  }
}

describe("Cloudflare result payload storage", () => {
  it("round-trips the exact 1 MiB boundary through sub-128 KiB values", async () => {
    const stub = env.CRUX_EVAL_HOST.get(
      env.CRUX_EVAL_HOST.idFromName("production-eu"),
    );

    await runInDurableObject(stub, async (_instance, state) => {
      const storage = asStoragePort(state.storage);
      const results = createCloudflareResultPort(storage);
      const payload = exactSizePayload(RUNTIME_RESULT_MAX_BYTES);

      const ref = await results.put(payload, { namespace: "boundary" });
      expect(ref.size).toBe(RUNTIME_RESULT_MAX_BYTES);
      await expect(results.get(ref)).resolves.toEqual(payload);

      const rows = await state.storage.list({
        prefix: `result:${ref.location}:chunk:`,
      });
      expect(rows.size).toBeGreaterThan(1);
      for (const value of rows.values()) {
        expect(value).toBeInstanceOf(Uint8Array);
        expect((value as Uint8Array).byteLength).toBeLessThan(128 * 1024);
      }
    });
  });

  it("rejects a canonical payload one byte over the protocol ceiling", async () => {
    const stub = env.CRUX_EVAL_HOST.get(
      env.CRUX_EVAL_HOST.idFromName("production-eu"),
    );

    await runInDurableObject(stub, async (_instance, state) => {
      const results = createCloudflareResultPort(asStoragePort(state.storage));
      const boundary = exactSizePayload(RUNTIME_RESULT_MAX_BYTES);
      await expect(
        results.put(
          { value: `${boundary.value}x` },
          {
            namespace: "boundary",
          },
        ),
      ).rejects.toMatchObject({ code: "EVAL_RESULT_TOO_LARGE" });
    });
  });

  it("fails closed on chunk corruption and removes every orphaned chunk", async () => {
    const stub = env.CRUX_EVAL_HOST.get(
      env.CRUX_EVAL_HOST.idFromName("production-eu"),
    );

    await runInDurableObject(stub, async (_instance, state) => {
      const storage = asStoragePort(state.storage);
      const results = createCloudflareResultPort(storage);
      const ref = await results.put(
        { value: "durable" },
        {
          namespace: "integrity",
        },
      );
      const metadataKey = `result:${ref.location}`;
      await state.storage.put(`${metadataKey}:chunk:0`, new Uint8Array([0]));

      await expect(results.get(ref)).rejects.toBeInstanceOf(Error);

      await results.delete(ref);
      expect((await state.storage.list({ prefix: metadataKey })).size).toBe(0);
    });
  });
});

function exactSizePayload(size: number): { value: string } {
  const overhead = canonicalRuntimeResult({ value: "" }).bytes.byteLength;
  const payload = { value: "x".repeat(size - overhead) };
  expect(canonicalRuntimeResult(payload).bytes.byteLength).toBe(size);
  return payload;
}
