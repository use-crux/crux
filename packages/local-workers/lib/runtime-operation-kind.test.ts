import { describe, expect, it } from "vitest";
import { isRuntimeOperationKind } from "./runtime-operation-kind";

describe("isRuntimeOperationKind", () => {
  it("accepts every operation handled by the Runtime worker, including preflight", () => {
    for (const operation of [
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
    for (const operation of ["setup-check", "setup-apply", "unknown"]) {
      expect(isRuntimeOperationKind(operation), operation).toBe(false);
    }
  });
});
