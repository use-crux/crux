import { describe, expect, it } from "vitest";
import { dataAccessTargetKindForVariable } from "../src/indexer/semantic/data-access-manifest";

describe("data access manifest", () => {
  it("matches target kinds on identifier tokens instead of substrings", () => {
    expect(dataAccessTargetKindForVariable("recordStore")).toBe(
      "storage.recordStore",
    );
    expect(dataAccessTargetKindForVariable("workspace_files")).toBe(
      "workspace",
    );
    expect(dataAccessTargetKindForVariable("memory-state")).toBe("memory");

    expect(dataAccessTargetKindForVariable("profile")).toBeUndefined();
    expect(dataAccessTargetKindForVariable("restoreCheckpoint")).toBeUndefined();
  });
});
