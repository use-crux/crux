import { afterEach, describe, expect, it, vi } from "vitest";
import { evalsService } from "./evals";

describe("Eval services", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses only the V3 catalog and run read models with encoded detail IDs", async () => {
    vi.stubGlobal("window", { location: { origin: "http://localhost:5173" } });
    const fetchMock = vi.fn(
      async (input: string | URL | Request, _init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/eval/catalog")) return new Response("[]");
        if (url.endsWith("/api/eval/runs") && _init?.method === "POST")
          return new Response(
            JSON.stringify({
              evalId: "support",
              runId: "evalrun-1",
              runIds: ["evalrun-1"],
              exitCode: 0,
              passed: true,
            }),
          );
        if (url.endsWith("/api/eval/runs"))
          return new Response(JSON.stringify([validRun()]));
        if (url.includes("/api/eval/runs/"))
          return new Response(JSON.stringify(validRun()));
        return new Response("{}");
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await evalsService.catalog();
    await evalsService.runs();
    await evalsService.run("run/id with space");
    await evalsService.runEval("support", true);
    await evalsService.setBaseline("run/id", "candidate", true);

    const calls = fetchMock.mock.calls;
    expect(calls.map(([url]) => url)).toEqual([
      "http://localhost:5173/api/eval/catalog",
      "http://localhost:5173/api/eval/runs",
      "http://localhost:5173/api/eval/runs/run%2Fid%20with%20space",
      "http://localhost:5173/api/eval/runs",
      "http://localhost:5173/api/eval/baselines",
    ]);
    expect(
      JSON.parse((fetchMock.mock.calls[3]?.[1] as RequestInit).body as string),
    ).toEqual({ evalId: "support", confirmUnknownCost: true });
    expect(
      JSON.parse((fetchMock.mock.calls[4]?.[1] as RequestInit).body as string),
    ).toEqual({
      runId: "run/id",
      variant: "candidate",
      acceptFailing: true,
    });
  });

  it("rejects malformed nested run artifacts instead of presenting them", async () => {
    vi.stubGlobal("window", { location: { origin: "http://localhost:5173" } });
    const malformed = [
      {
        run: validRun({ task: { status: "impossible" } }),
        path: "cells[0].task.status",
      },
      {
        run: validRun(
          {},
          {
            comparison: {
              baselineId: "baseline-1",
              baselineRunId: "run-1",
              selectedArm: "current",
              cases: [
                {
                  caseId: "refund",
                  status: "compatible",
                  metrics: [
                    {
                      name: "helpful",
                      status: "compatible",
                      baseline: 0.8,
                      candidate: 0.9,
                    },
                  ],
                },
              ],
              unmatchedCases: { baselineOnly: [], candidateOnly: [] },
            },
          },
        ),
        path: "comparison.cases[0].metrics[0]",
      },
    ];

    for (const test of malformed) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(JSON.stringify([test.run]))),
      );
      await expect(evalsService.runs()).rejects.toThrow(
        `malformed Eval run 'bad' at ${test.path}`,
      );
    }
  });

  it("rejects a malformed Run Eval mutation result", async () => {
    vi.stubGlobal("window", { location: { origin: "http://localhost:5173" } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ evalId: "support" }))),
    );

    await expect(evalsService.runEval("support", true)).rejects.toThrow(
      "malformed Run Eval response for 'support'",
    );
  });

  it("proves observed run references through bounded successful list reads", async () => {
    vi.stubGlobal("window", { location: { origin: "http://localhost:5173" } });
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      return new Response(
        JSON.stringify(
          url.includes("search=run-known")
            ? [{ operationId: "run-known" }]
            : [],
        ),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const availability = await evalsService.localRunAvailability([
      "run-known",
      "run-missing",
      "run-known",
    ]);

    expect([...availability]).toEqual([
      ["run-known", true],
      ["run-missing", false],
    ]);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "http://localhost:5173/api/inspect/runs?search=run-known&limit=1",
      "http://localhost:5173/api/inspect/runs?search=run-missing&limit=1",
    ]);
  });

  it.each([
    "model_identity_unattested",
    "unresolved_source_dependency",
    "nondeterministic_renderer",
  ] as const)("accepts the canonical %s reason", async (reason) => {
    vi.stubGlobal("window", { location: { origin: "http://localhost:5173" } });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify([
              validRun({
                task: {
                  status: "executed",
                  reason,
                },
              }),
            ]),
          ),
      ),
    );

    await expect(evalsService.runs()).resolves.toHaveLength(1);
  });
});

function validRun(
  cellOverride: Record<string, unknown> = {},
  runOverride: Record<string, unknown> = {},
) {
  return {
    schemaVersion: 3,
    runId: "bad",
    evalId: "support",
    sourceKey: { relativeFile: "support.eval.ts", export: "default" },
    definitionFingerprint: "definition-v1",
    status: "complete",
    passed: true,
    startedAt: 1,
    endedAt: 2,
    selection: {
      cases: ["refund"],
      variants: ["current"],
      trials: 1,
      caseTrials: { refund: 1 },
    },
    costControl: "not_required",
    blockingVariants: ["current"],
    cells: [
      {
        caseId: "refund",
        variant: "current",
        trial: 0,
        status: "passed",
        task: { status: "executed", reason: "no_exact_evidence" },
        scores: [],
        assertions: { ran: 0, notEvaluated: 0, outcomes: [] },
        input: { question: "Can I get a refund?" },
        metrics: { durationMs: 1 },
        runIds: [],
        capturedSignals: [],
        ...cellOverride,
      },
    ],
    variants: [
      {
        name: "current",
        fingerprint: "variant-v1",
        overrideKeys: [],
        blocking: true,
      },
    ],
    aggregates: {
      current: {
        cells: 1,
        passed: 1,
        failed: 0,
        errored: 0,
        skipped: 0,
        passRate: 1,
        scores: {},
        trialConsistency: 1,
        latencyMs: 1,
      },
    },
    gates: { passed: true, blockingPassed: true, results: [] },
    cost: {
      reservedMaximumUsd: 0,
      unknownActionCount: 0,
      task: {},
      judge: {},
    },
    provenance: { task: "managed", host: "injected", evidenceStore: "none" },
    ...runOverride,
  };
}
