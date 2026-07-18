import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EvalRunAction } from "./EvalRunAction";

describe("EvalRunAction", () => {
  it("makes the run action and in-flight state obvious", () => {
    expect(
      renderToStaticMarkup(
        <EvalRunAction
          evalId="support"
          pending={false}
          onRun={() => undefined}
        />,
      ),
    ).toContain("Run Eval");
    expect(
      renderToStaticMarkup(
        <EvalRunAction
          evalId="support"
          pending
          onRun={() => undefined}
        />,
      ),
    ).toContain("Running…");
  });

  it("keeps coordinator failures visible and actionable", () => {
    const markup = renderToStaticMarkup(
      <EvalRunAction
        evalId="support"
        pending={false}
        error="Run Eval blocked: configure pricing or use crux eval support --max-cost 1."
        onRun={() => undefined}
      />,
    );
    expect(markup).toContain("configure pricing");
    expect(markup).toContain('role="alert"');
  });
});
