import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { EvalRunRecord } from "../types";
import { EvalRunSummary } from "./EvalRunSummary";

describe("EvalRunSummary", () => {
  it("shows task and judge spend separately", () => {
    const run = {
      schemaVersion: 3,
      runId: "eval-run-cost",
      evalId: "support",
      sourceKey: { relativeFile: "support.eval.ts", export: "default" },
      definitionFingerprint: "definition-v1",
      startedAt: 1,
      endedAt: 2,
      status: "complete",
      passed: true,
      selection: {},
      cells: [],
      cost: {
        actualUsd: 0.05,
        reservedMaximumUsd: 0.1,
        unknownActionCount: 0,
        task: { actualUsd: 0.02 },
        judge: { actualUsd: 0.03 },
      },
    } satisfies EvalRunRecord;

    const markup = renderToStaticMarkup(<EvalRunSummary run={run} />);
    expect(markup).toContain("Task cost");
    expect(markup).toContain("$0.0200");
    expect(markup).toContain("Judge cost");
    expect(markup).toContain("$0.0300");
  });

  it("explains how to enable reuse for an unattested model once", () => {
    const run = {
      schemaVersion: 3,
      runId: "eval-run-1",
      evalId: "support",
      sourceKey: { relativeFile: "support.eval.ts", export: "default" },
      definitionFingerprint: "definition-v1",
      startedAt: 1,
      endedAt: 2,
      status: "complete",
      passed: true,
      selection: {},
      cells: [
        {
          caseId: "refund",
          variant: "current",
          status: "passed",
          task: {
            status: "executed",
            reason: "model_identity_unattested",
          },
        },
        {
          caseId: "exchange",
          variant: "current",
          status: "passed",
          task: {
            status: "executed",
            reason: "model_identity_unattested",
          },
        },
      ],
    } satisfies EvalRunRecord;

    const markup = renderToStaticMarkup(<EvalRunSummary run={run} />);
    expect(markup.match(/stableModel\(model\)/g)).toHaveLength(1);
    expect(markup).toContain("@use-crux/ai");
  });

  it("explains unresolved authored source dependencies once", () => {
    const run = {
      schemaVersion: 3,
      runId: "eval-run-1",
      evalId: "support",
      sourceKey: { relativeFile: "support.eval.ts", export: "default" },
      definitionFingerprint: "definition-v1",
      startedAt: 1,
      endedAt: 2,
      status: "complete",
      passed: true,
      selection: {},
      cells: ["refund", "exchange"].map((caseId) => ({
        caseId,
        variant: "current",
        status: "passed",
        task: {
          status: "executed" as const,
          reason: "unresolved_source_dependency" as const,
        },
      })),
    } satisfies EvalRunRecord;

    const markup = renderToStaticMarkup(<EvalRunSummary run={run} />);
    expect(
      markup.match(/complete authored source dependency closure/g),
    ).toHaveLength(1);
    expect(markup).toContain("literal ESM");
  });

  it("explains how to make an untracked task binding reusable once", () => {
    const run = {
      schemaVersion: 3,
      runId: "eval-run-1",
      evalId: "support",
      sourceKey: { relativeFile: "support.eval.ts", export: "default" },
      definitionFingerprint: "definition-v1",
      startedAt: 1,
      endedAt: 2,
      status: "complete",
      passed: true,
      selection: {},
      cells: ["refund", "exchange"].map((caseId) => ({
        caseId,
        variant: "current",
        status: "passed",
        task: {
          status: "executed" as const,
          reason: "task_binding_untracked" as const,
        },
      })),
    } satisfies EvalRunRecord;

    const markup = renderToStaticMarkup(<EvalRunSummary run={run} />);
    expect(markup.match(/managed task binding/g)).toHaveLength(1);
    expect(markup).toContain("generate.task()");
    expect(markup).toContain("literal ESM import");
  });

  it("explains a managed renderer mismatch", () => {
    const run = {
      schemaVersion: 3,
      runId: "eval-run-1",
      evalId: "support",
      sourceKey: { relativeFile: "support.eval.ts", export: "default" },
      definitionFingerprint: "definition-v1",
      startedAt: 1,
      endedAt: 2,
      status: "complete",
      passed: true,
      selection: {},
      cells: [
        {
          caseId: "refund",
          variant: "current",
          status: "passed",
          task: {
            status: "executed",
            reason: "nondeterministic_renderer",
          },
        },
      ],
    } satisfies EvalRunRecord;

    const markup = renderToStaticMarkup(<EvalRunSummary run={run} />);
    expect(markup).toContain("rendered differently for the same input");
    expect(markup).toContain("Case input");
  });
});
