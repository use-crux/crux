import { describe, expect, it } from "vitest";
import {
  primitiveFamily,
  primitiveTagLabel,
  primitiveTone,
} from "./families";

describe("Thread primitive presentation", () => {
  it("renders Thread operations as State primitives", () => {
    expect(primitiveFamily("thread.operation")).toBe("state");
    expect(primitiveTone("thread.operation")).toBe("plum");
    expect(primitiveTagLabel("thread.operation")).toBe("thread");
  });
});
