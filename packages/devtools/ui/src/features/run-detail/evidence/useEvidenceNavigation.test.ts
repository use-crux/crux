import { describe, expect, it } from "vitest";
import {
  navigationCandidatesForSubject,
  selectResolvedEvidenceNavigation,
} from "./useEvidenceNavigation";

describe("exact evidence navigation", () => {
  it("asks Local for both canonical execution kinds without ID inference", () => {
    expect(
      navigationCandidatesForSubject({
        kind: "execution",
        id: "opaque_execution",
      }),
    ).toEqual([
      { kind: "run", id: "opaque_execution" },
      { kind: "span", id: "opaque_execution" },
    ]);
  });

  it("fails closed when an execution ID resolves as both run and span", () => {
    const target = {
      kind: "run" as const,
      runId: "same",
      traceId: "trace",
      retainedDefinitionRefs: [],
    };
    expect(
      selectResolvedEvidenceNavigation([
        {
          ref: { kind: "run", id: "same" },
          status: "resolved",
          target,
        },
        {
          ref: { kind: "span", id: "same" },
          status: "resolved",
          target: {
            kind: "span",
            spanId: "same",
            runId: "run",
            traceId: "trace",
            retainedDefinitionRefs: [],
          },
        },
      ]),
    ).toBeUndefined();
  });
});
