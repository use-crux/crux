import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { EvalRunRecord } from "../types";
import { EvalRunBaselineAction } from "./EvalRunBaselineAction";

const run = (over: Partial<EvalRunRecord> = {}): EvalRunRecord => ({
  schemaVersion: 3,
  runId: "run_0123456789abcdef01234567",
  evalId: "support",
  status: "complete",
  passed: true,
  startedAt: 1,
  endedAt: 2,
  selection: {},
  cells: [],
  ...over,
});

describe("EvalRunBaselineAction", () => {
  it("offers promotion only for complete, unfiltered runs", () => {
    expect(
      renderToStaticMarkup(
        <EvalRunBaselineAction
          run={run()}
          pending={false}
          onSet={() => undefined}
        />,
      ),
    ).toContain("Set current as Baseline");
    expect(
      renderToStaticMarkup(
        <EvalRunBaselineAction
          run={run({ selection: { filtered: true } })}
          pending={false}
          onSet={() => undefined}
        />,
      ),
    ).toContain("Filtered runs cannot become Baselines");
    expect(
      renderToStaticMarkup(
        <EvalRunBaselineAction
          run={run({ status: "incomplete", passed: false })}
          pending={false}
          onSet={() => undefined}
        />,
      ),
    ).toContain("Incomplete runs cannot become Baselines");
  });
});
