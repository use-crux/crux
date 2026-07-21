import { describe, expect, it } from "vitest";
import { isSnapshotJsonValue } from "../../../src/workspace/snapshot/record-validation";

describe("workspace snapshot record validation", () => {
  it("accepts only recursively finite, dense, undefined-free JSON", () => {
    const sparse = new Array<null>(1);

    expect(isSnapshotJsonValue({ nested: [null, 1, "value"] })).toBe(true);
    expect(isSnapshotJsonValue({ nested: Number.NaN })).toBe(false);
    expect(isSnapshotJsonValue({ nested: undefined })).toBe(false);
    expect(isSnapshotJsonValue({ nested: sparse })).toBe(false);
  });
});
