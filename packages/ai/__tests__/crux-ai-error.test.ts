import { describe, expect, it } from "vitest";
import { CruxAIError } from "../src";

describe("CruxAIError", () => {
  it("classifies only canonical Crux TimeoutErrors as structured timeouts", () => {
    const canonical = Object.assign(new Error("step timeout exceeded 25ms"), {
      name: "TimeoutError",
      budget: "step",
      limitMs: 25,
    });
    Object.defineProperty(
      canonical,
      Symbol.for("@use-crux/core/TimeoutError"),
      { value: true },
    );
    const renamed = new Error("not canonical");
    renamed.name = "TimeoutError";

    expect(CruxAIError.classify(canonical)).toMatchObject({
      code: "timeout",
      cause: canonical,
    });
    expect(CruxAIError.classify(renamed)).toMatchObject({
      code: "provider",
      cause: renamed,
    });
  });
});
