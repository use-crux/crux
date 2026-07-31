import { describe, expect, it } from "vitest";
import { primitiveFamily, primitiveTone } from "./families";

describe("Effect primitive family", () => {
  it("uses the existing State family tone", () => {
    expect(primitiveFamily("effect.run")).toBe("state");
    expect(primitiveTone("effect.run")).toBe("plum");
  });
});
