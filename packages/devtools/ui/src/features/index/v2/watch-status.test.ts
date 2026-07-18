import { describe, expect, it } from "vitest";
import { normalizeWatchStatus } from "../services/index";
import { summarizeProjectIndexWatchStatus } from "./watch-status";

describe("project index watch status summary", () => {
  it("keeps fallback reasons visible", () => {
    const status = normalizeWatchStatus({
      state: "fallback",
      lastRun: {
        runId: 7,
        status: "fallback",
        fallbackUsed: true,
        fallbackReason: "missing-previous-source-graph",
        changedFileCount: 1,
        deletedFileCount: 0,
        affectedFileCount: 0,
        affectedDefinitionCount: 0,
        patchCount: 0,
        semanticStatus: "not-requested",
      },
    });

    expect(summarizeProjectIndexWatchStatus(status)).toMatchObject({
      label: "fallback",
      detail: "missing-previous-source-graph",
      tone: "warn",
      pulse: true,
    });
  });

  it("surfaces superseded semantic work without marking syntax stale", () => {
    const status = normalizeWatchStatus({
      state: "idle",
      lastRun: {
        runId: 8,
        status: "semantic-stale-dropped",
        fallbackUsed: false,
        changedFileCount: 1,
        deletedFileCount: 0,
        affectedFileCount: 1,
        affectedDefinitionCount: 2,
        patchCount: 1,
        semanticStatus: "stale-dropped",
        staleSemanticDropped: true,
      },
    });

    expect(summarizeProjectIndexWatchStatus(status)).toMatchObject({
      label: "syntax ready",
      detail: "semantic superseded",
      tone: "blue",
      pulse: false,
    });
  });
});
