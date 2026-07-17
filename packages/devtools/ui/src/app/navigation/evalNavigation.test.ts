import { describe, expect, it } from "vitest";
import { pathFromState, stateFromPath } from "./useNavigation";
import { QW_NAV } from "@/qw/shell/nav";

describe("Eval V1 navigation", () => {
  it.each([
    [
      { view: "evals", evalId: "support/refunds" } as const,
      "/evals/support%2Frefunds",
    ],
    [{ view: "eval-runs", runId: "run one" } as const, "/eval-runs/run%20one"],
    [{ view: "baselines" } as const, "/baselines"],
    [
      { view: "review", reviewId: "review/one" } as const,
      "/review/review%2Fone",
    ],
  ])("round-trips %o", (state, path) => {
    expect(pathFromState(state)).toBe(path);
    expect(stateFromPath(path)).toEqual(state);
  });

  it("has no legacy Quality lifecycle routes or navigation labels", () => {
    const labels = QW_NAV.flatMap((group) =>
      group.items.map((item) => item.label),
    );
    expect(labels).not.toEqual(
      expect.arrayContaining([
        "Evaluations",
        "Experiments",
        "Cassettes",
        "Scorers",
        "Feedback",
      ]),
    );
    for (const path of [
      "/evaluations",
      "/experiments",
      "/cassettes",
      "/scorers",
      "/feedback",
    ]) {
      expect(stateFromPath(path)).toEqual({ view: "overview" });
    }
  });
});
