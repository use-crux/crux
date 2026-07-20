import { describe, expect, it } from "vitest";
import {
  RuntimeArtifactGenerationError,
  renderRuntimeArtifactFindings,
  runtimeArtifactGenerationError,
  sortRuntimeArtifactFindings,
} from "../../src/indexer/runtime-artifacts/findings";
import type { RuntimeArtifactFinding } from "../../src/indexer/runtime-artifacts/types";

const findings = [
  finding({ code: "E_Z", source: "z.eval.ts", featureId: "z", arm: "current" }),
  finding({ code: "E_B", source: "a.eval.ts", featureId: "b", arm: "variant" }),
  finding({ code: "E_A", source: "a.eval.ts", featureId: "a", arm: "variant" }),
  finding({
    code: "E_CURRENT",
    source: "a.eval.ts",
    featureId: "a",
    arm: "current",
  }),
  finding({
    code: "E_CODE",
    source: "a.eval.ts",
    featureId: "a",
    arm: "current-2",
  }),
  finding({ code: "E_ROOT", featureId: "root" }),
] satisfies readonly RuntimeArtifactFinding[];

describe("Runtime artifact findings", () => {
  it("retains an unexpected cause without exposing its stack", () => {
    const cause = new Error("private stack detail");
    const error = runtimeArtifactGenerationError(cause);

    expect(error.cause).toBe(cause);
    expect(error.findings).toHaveLength(1);
    expect(error.findings[0]).not.toHaveProperty("stack");
  });

  it("sorts by source, feature id, arm, and code regardless of completion order", () => {
    expect(
      sortRuntimeArtifactFindings([...findings].reverse()).map(code),
    ).toEqual(
      sortRuntimeArtifactFindings([
        findings[2]!,
        findings[5]!,
        findings[0]!,
        findings[4]!,
        findings[1]!,
        findings[3]!,
      ]).map(code),
    );
    expect(sortRuntimeArtifactFindings(findings).map(code)).toEqual([
      "E_ROOT",
      "E_CURRENT",
      "E_CODE",
      "E_A",
      "E_B",
      "E_Z",
    ]);
  });

  it("keeps every typed child while bounding plain human output", () => {
    const error = new RuntimeArtifactGenerationError(findings);

    expect(error.code).toBe("RUNTIME_ARTIFACT_GENERATION_FAILED");
    expect(error.findings).toHaveLength(6);
    expect(error.findings.map(code)).toEqual(
      sortRuntimeArtifactFindings(findings).map(code),
    );
    expect(error.message).toBe(renderRuntimeArtifactFindings(error.findings));
    expect(error.message).toContain("and 1 more");
    expect(error.message).not.toMatch(
      /descriptor|opaque|placement|eligibility/i,
    );
  });

  it("does not invent remediation for internal or environmental failures", () => {
    const authored = finding({
      code: "E_AUTHORED",
      category: "authored",
      remediation: "Export the named target, then save the file.",
    });
    const environment = finding({
      code: "E_ENVIRONMENT",
      category: "environment",
    });
    const internal = finding({ code: "E_INTERNAL", category: "internal" });

    expect(authored.remediation).toBeDefined();
    expect(environment).not.toHaveProperty("remediation");
    expect(internal).not.toHaveProperty("remediation");
  });
});

function finding(
  overrides: Partial<RuntimeArtifactFinding>,
): RuntimeArtifactFinding {
  return {
    code: "E_DEFAULT",
    category: "authored",
    featureKind: "eval",
    summary: "Could not prepare this Eval.",
    reason: "The authored definition is not valid.",
    ...overrides,
  };
}

function code(finding: RuntimeArtifactFinding): string {
  return finding.code;
}
