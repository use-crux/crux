import { describe, expect, it } from "vitest";
import { vercel } from "@use-crux/vercel";

describe("vercel host binding", () => {
  it("declares an ambient Vercel binding", () => {
    expect(vercel()).toMatchObject({
      kind: "vercel",
      invocationScope: true,
      supportsInline: true,
    });
  });
});
