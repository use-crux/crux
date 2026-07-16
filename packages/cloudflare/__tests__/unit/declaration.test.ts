import { describe, expect, it } from "vitest";
import { CruxRuntimeError, createRuntime } from "@use-crux/core/runtime";
import { CLOUDFLARE_RUNTIME_ENTRY, cloudflare } from "../../src/index";

describe("cloudflare() Runtime declaration", () => {
  it("is inert outside a bound Worker entry", () => {
    const runtime = cloudflare({ namespace: "tenant-a" });

    expect(runtime).toMatchObject({
      kind: "host-bound",
      id: "cloudflare",
      host: "cloudflare",
      namespace: "tenant-a",
      entry: CLOUDFLARE_RUNTIME_ENTRY,
    });
    expect(() => createRuntime({ runtime })).toThrow(CruxRuntimeError);
    expect(() => createRuntime({ runtime })).toThrow(/generated Cloudflare/);
  });
});
