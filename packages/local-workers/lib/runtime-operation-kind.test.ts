import { describe, expect, it } from "vitest";
import { isRuntimeOperationKind } from "./runtime-operation-kind";

describe("isRuntimeOperationKind", () => {
  it("accepts every operation handled by the Runtime worker, including preflight", () => {
    for (const operation of [
      "setup-check",
      "setup-apply",
      "preflight",
      "status",
      "inspect",
      "retry",
      "cancel",
    ]) {
      expect(isRuntimeOperationKind(operation), operation).toBe(true);
    }
  });

  it("rejects unknown operations", () => {
    expect(isRuntimeOperationKind("unknown")).toBe(false);
  });
});
