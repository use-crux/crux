import { describe, expect, it, vi } from "vitest";
import {
  adapter,
  config,
  offload,
  prompt,
  type AdapterSpec,
  type CallArgs,
} from "../src";
import {
  inMemoryAssetStore,
  inMemoryRecordStore,
  inMemoryStorage,
  storage,
  type JsonObject,
  type RecordStore,
} from "../src/storage";
import { historyResponse as response } from "./request-history-harness";

describe.sequential("offload governance", () => {
  it("denies cross-tenant and expired handles without revealing which condition failed", async () => {
    const base = inMemoryStorage();
    const tenantA = storage.scope(base, "tenant-a");
    const tenantB = storage.scope(base, "tenant-b");
    const installedA = config({
      persistence: { records: tenantA.records },
    });
    let support:
      | NonNullable<CallArgs["tools"]>[number]
      | undefined;
    let handle: string | undefined;
    const spec: AdapterSpec<object, { readonly text: string }> = {
      providerId: "offload-owner-test",
      capacity: () => ({
        contextWindow: 32_768,
        defaultOutputReserve: 256,
        countingConfidence: "estimated",
      }),
      async call(_client, args) {
        support = args.tools?.find(
          (entry) => entry.name === "__crux_ReadOffload",
        );
        handle = args.system?.match(/offload_[a-f0-9]+/)?.[0];
        return { raw: { text: "done" }, extracted: response("done") };
      },
      async stream() {
        throw new Error("not used");
      },
      appendToolRound: (value) => value,
      mapSettings: () => ({}),
    };

    await adapter(spec)({}).generate(
      prompt({
        id: "offload-owner",
        use: [offload("tenant-a exact value")],
        prompt: "Read the value.",
      }),
      { model: "owner-model" },
    );
    installedA.dispose();
    expect(support).toBeDefined();
    expect(handle).toMatch(/^offload_[a-f0-9]+$/);

    const installedB = config({
      persistence: { records: tenantB.records },
    });
    const crossTenant = await support!
      .execute({ handle })
      .catch((error: unknown) => error);
    installedB.dispose();

    const installedAgain = config({
      persistence: { records: tenantA.records },
    });
    const record = (
      await tenantA.records.list("crux:request-offload:v1:")
    ).entries[0]!;
    await tenantA.records.put(record.key, {
      ...record.value,
      expiresAt: 0,
    });
    const expired = await support!
      .execute({ handle })
      .catch((error: unknown) => error);
    installedAgain.dispose();

    expect(crossTenant).toEqual(
      expect.objectContaining({
        message: "Exact-recovery reference is unavailable.",
      }),
    );
    expect(expired).toEqual(
      expect.objectContaining({
        message: "Exact-recovery reference is unavailable.",
      }),
    );
  });

  it("invalidates a revoked pinned revision before provider dispatch", async () => {
    const base = inMemoryRecordStore();
    const records: RecordStore = {
      ...base,
      async create(key, value, options) {
        const created = await base.create(key, value, options);
        if (created) {
          await base.put(key, {
            ...(value as JsonObject),
            revoked: true,
          });
        }
        return created;
      },
    };
    const installation = config({ persistence: { records } });
    let calls = 0;
    const spec: AdapterSpec<object, { readonly text: string }> = {
      providerId: "offload-revision-test",
      capacity: () => ({
        contextWindow: 32_768,
        defaultOutputReserve: 256,
        countingConfidence: "estimated",
      }),
      async call() {
        calls += 1;
        return { raw: { text: "done" }, extracted: response("done") };
      },
      async stream() {
        throw new Error("not used");
      },
      appendToolRound: (value) => value,
      mapSettings: () => ({}),
    };

    try {
      await expect(
        adapter(spec)({}).generate(
          prompt({
            id: "offload-revoked",
            use: [offload("revoked exact value")],
            prompt: "Read the value.",
          }),
          { model: "revision-model" },
        ),
      ).rejects.toThrow("Exact-recovery reference is unavailable.");
      expect(calls).toBe(0);
    } finally {
      installation.dispose();
    }
  });

  it("reuses already-addressable asset bytes without exposing the backing URI", async () => {
    const backingAssets = inMemoryAssetStore();
    const stored = await backingAssets.put({
      type: "data",
      data: new Uint8Array([1, 2, 3, 4]),
      mediaType: "application/octet-stream",
      filename: "trace.bin",
    });
    const put = vi.fn(backingAssets.put);
    const installation = config({
      persistence: {
        records: inMemoryRecordStore(),
        assets: { ...backingAssets, put },
      },
    });
    let request: CallArgs | undefined;
    const spec: AdapterSpec<object, { readonly text: string }> = {
      providerId: "offload-asset-test",
      capacity: () => ({
        contextWindow: 32_768,
        defaultOutputReserve: 256,
        countingConfidence: "estimated",
      }),
      async call(_client, args) {
        request = args;
        return { raw: { text: "done" }, extracted: response("done") };
      },
      async stream() {
        throw new Error("not used");
      },
      appendToolRound: (value) => value,
      mapSettings: () => ({}),
    };

    try {
      await adapter(spec)({}).generate(
        prompt({
          id: "offload-asset",
          use: [offload(stored)],
          prompt: "Inspect the exact asset.",
        }),
        { model: "asset-model" },
      );

      expect(put).not.toHaveBeenCalled();
      expect(request?.system).toContain(
        "[Exact application/octet-stream asset reference]",
      );
      expect(JSON.stringify(request)).not.toContain(stored.ref.uri);
      const handle = request?.system?.match(/offload_[a-f0-9]+/)?.[0];
      const support = request?.tools?.find(
        (entry) => entry.name === "__crux_ReadOffload",
      );
      const recovered = await support?.execute({ handle });
      expect(recovered).toMatchObject({
        type: "data",
        mediaType: "application/octet-stream",
        filename: "trace.bin",
        ref: stored.ref,
      });
      expect(
        Array.from((recovered as typeof stored).data as Uint8Array),
      ).toEqual([1, 2, 3, 4]);
    } finally {
      installation.dispose();
    }
  });
});
