import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvalRunRecord } from "../types";
import { EvalRunsView } from "./EvalRunsView";

const state = vi.hoisted(() => ({
  mutation: {
    isPending: false,
    isError: false,
    variables: undefined as { runId: string } | undefined,
    error: undefined as Error | undefined,
    mutate: vi.fn(),
  },
}));

vi.mock("@/app/navigation/useNavigation", () => ({
  useNavigation: () => ({ navigate: vi.fn() }),
}));

vi.mock("@/devtools/shell/DevtoolsShell", () => ({
  DevtoolsShell: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("../hooks/useEvals", () => ({
  useEvalRuns: () => ({ data: [run()] }),
  useEvalRun: () => ({ data: run() }),
  useLocalRunAvailability: () => ({ isPending: false, data: new Map() }),
  useSetEvalBaseline: () => state.mutation,
}));

const run = (): EvalRunRecord => ({
  schemaVersion: 3,
  runId: "run-selected",
  evalId: "support",
  sourceKey: { relativeFile: "support.eval.ts", export: "default" },
  definitionFingerprint: "definition-v1",
  status: "complete",
  passed: true,
  startedAt: 1,
  endedAt: 2,
  selection: {},
  cells: [],
});

describe("EvalRunsView", () => {
  beforeEach(() => {
    state.mutation.isPending = false;
    state.mutation.isError = false;
    state.mutation.variables = undefined;
    state.mutation.error = undefined;
  });

  it("scopes Baseline progress and errors to the selected run", () => {
    state.mutation.isPending = true;
    state.mutation.variables = { runId: "run-other" };

    const unrelatedProgress = renderToStaticMarkup(
      <EvalRunsView runId="run-selected" />,
    );
    expect(unrelatedProgress).toContain("Set current as Baseline");
    expect(unrelatedProgress).not.toContain("Setting Baseline");

    state.mutation.variables = { runId: "run-selected" };
    const selectedProgress = renderToStaticMarkup(
      <EvalRunsView runId="run-selected" />,
    );
    expect(selectedProgress).toContain("Setting Baseline");

    state.mutation.isPending = false;
    state.mutation.isError = true;
    state.mutation.error = new Error("Other run failed");
    state.mutation.variables = { runId: "run-other" };
    const unrelatedError = renderToStaticMarkup(
      <EvalRunsView runId="run-selected" />,
    );
    expect(unrelatedError).not.toContain("Other run failed");

    state.mutation.variables = { runId: "run-selected" };
    const selectedError = renderToStaticMarkup(
      <EvalRunsView runId="run-selected" />,
    );
    expect(selectedError).toContain("Other run failed");
  });
});
