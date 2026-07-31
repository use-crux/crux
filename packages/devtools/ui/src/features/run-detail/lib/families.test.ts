import { describe, expect, it } from "vitest";
import {
  primitiveFamily,
  primitiveTagLabel,
  primitiveTone,
} from "./families";

describe("Effect primitive family", () => {
  it("uses the existing State family tone", () => {
    expect(primitiveFamily("effect.run")).toBe("state");
    expect(primitiveTone("effect.run")).toBe("plum");
  });
});

describe("Thread primitive presentation", () => {
  it("renders Thread operations as State primitives", () => {
    expect(primitiveFamily("thread.operation")).toBe("state");
    expect(primitiveTone("thread.operation")).toBe("plum");
    expect(primitiveTagLabel("thread.operation")).toBe("thread");
  });
});
