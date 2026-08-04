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

describe("Session primitive presentation", () => {
  it("renders Session turns as State primitives", () => {
    expect(primitiveFamily("session.turn")).toBe("state");
    expect(primitiveTone("session.turn")).toBe("plum");
    expect(primitiveTagLabel("session.turn")).toBe("session");
  });
});

describe("Connected Knowledge primitive presentation", () => {
  it("renders Knowledge retrieval steps as Capabilities primitives", () => {
    expect(primitiveFamily("knowledge.expand-relations")).toBe("capabilities");
    expect(primitiveTone("knowledge.expand-relations")).toBe("ok");
    expect(primitiveTagLabel("knowledge.expand-relations")).toBe("expand");
    expect(primitiveTagLabel("knowledge.global-search")).toBe("search");
    expect(primitiveTagLabel("knowledge.derive")).toBe("derive");
    expect(primitiveTagLabel("knowledge.compile")).toBe("compile");
  });
});
