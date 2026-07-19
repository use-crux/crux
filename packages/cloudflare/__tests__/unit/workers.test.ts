import { describe, expect, it, vi } from "vitest";
import { workers } from "../../src/workers";

describe("workers host binding", () => {
  it("retains the kernel callback with waitUntil", async () => {
    let retained: Promise<unknown> | undefined;
    const work = vi.fn(async () => {});
    const binding = workers({
      ctx: { waitUntil: (promise) => (retained = promise) },
    });

    binding.retain(work);

    expect(binding).toMatchObject({ kind: "workers", invocationScope: true });
    expect(work).toHaveBeenCalledOnce();
    await retained;
  });

  it("names both supported context forms when context is missing", () => {
    expect(() => workers().retain(async () => {})).toThrow(
      expect.objectContaining({
        code: "DEFER_CAPABILITY_MISSING",
        message: expect.stringContaining("workers({ ctx })"),
      }),
    );
    expect(() => workers().retain(async () => {})).toThrow(
      expect.objectContaining({ message: expect.stringContaining("withCrux") }),
    );
  });
});
