import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { EvalRunRecord } from "../types";
import { EvalRunBaselineAction } from "./EvalRunBaselineAction";

const run = (over: Partial<EvalRunRecord> = {}): EvalRunRecord => ({
  schemaVersion: 3,
  runId: "run_0123456789abcdef01234567",
  evalId: "support",
  sourceKey: { relativeFile: "support.eval.ts", export: "default" },
  definitionFingerprint: "definition-v1",
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
          selectedArm="current"
          onArmChange={() => undefined}
          onSet={() => undefined}
        />,
      ),
    ).toContain("Set current as Baseline");
    expect(
      renderToStaticMarkup(
        <EvalRunBaselineAction
          run={run({ selection: { filtered: true } })}
          pending={false}
          selectedArm="current"
          onArmChange={() => undefined}
          onSet={() => undefined}
        />,
      ),
    ).toContain("Filtered runs cannot become Baselines");
    expect(
      renderToStaticMarkup(
        <EvalRunBaselineAction
          run={run({ status: "incomplete", passed: false })}
          pending={false}
          selectedArm="current"
          onArmChange={() => undefined}
          onSet={() => undefined}
        />,
      ),
    ).toContain("Incomplete runs cannot become Baselines");
  });

  it("requires an explicit arm and warns before accepting a failing run", () => {
    const markup = renderToStaticMarkup(
      <EvalRunBaselineAction
        run={run({
          passed: false,
          variants: [
            {
              name: "current",
              fingerprint: "current-fp",
              overrideKeys: [],
              blocking: true,
            },
            {
              name: "cheaper",
              fingerprint: "cheap-fp",
              overrideKeys: ["model"],
              blocking: true,
            },
          ],
        })}
        pending={false}
        selectedArm="cheaper"
        onArmChange={() => undefined}
        onSet={() => undefined}
      />,
    );
    expect(markup).toContain("cheaper");
    expect(markup).toContain("This run failed");
    expect(markup).toContain("Accept cheaper as Baseline anyway");
  });
});
