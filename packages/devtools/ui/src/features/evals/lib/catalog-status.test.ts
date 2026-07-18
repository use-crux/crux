import { describe, expect, it } from "vitest";
import {
  currentArmStatus,
  hostReadinessDetails,
  hostReadinessPresentation,
} from "./catalog-status";

describe("Eval catalog host readiness", () => {
  it("never presents absent readiness as local execution", () => {
    expect(hostReadinessPresentation(undefined)).toEqual({
      label: "Runtime readiness unavailable",
      tone: "danger",
    });
  });

  it("distinguishes ready, setup, unverified, and mismatch states", () => {
    expect(
      hostReadinessPresentation({ status: "ready", mode: "local" }),
    ).toEqual({ label: "Runs locally", tone: "muted" });
    expect(
      hostReadinessPresentation({
        status: "setup-required",
        reason: "connection_unavailable",
        remedies: ["Set CRUX_EVAL_HOST_TOKEN"],
      }),
    ).toEqual({ label: "Runtime setup required", tone: "warn" });
    expect(
      hostReadinessPresentation({
        status: "unverified",
        reason: "transport",
        remedies: ["Check the deployment"],
      }),
    ).toEqual({ label: "Runtime unverified", tone: "warn" });
    expect(
      hostReadinessPresentation({
        status: "mismatch",
        reason: "stale registry",
        remedy: "Regenerate and deploy",
      }),
    ).toEqual({ label: "Runtime mismatch", tone: "danger" });
  });

  it("preserves deployment metadata and actionable setup/mismatch remedies", () => {
    expect(
      hostReadinessDetails({
        status: "ready",
        mode: "deployed",
        deploymentId: "deployment-1",
        hostKind: "cloudflare",
      }),
    ).toEqual({
      metadata: [
        "deployed Runtime",
        "deployment deployment-1",
        "host cloudflare",
      ],
      remedies: [],
    });
    expect(
      hostReadinessDetails({
        status: "setup-required",
        reason: "connection_unavailable",
        remedies: ["Set CRUX_EVAL_HOST_TOKEN."],
      }),
    ).toMatchObject({ remedies: ["Set CRUX_EVAL_HOST_TOKEN."] });
    expect(
      hostReadinessDetails({
        status: "mismatch",
        reason: "stale_registry",
        remedy: "Regenerate and deploy the Eval registry.",
      }),
    ).toMatchObject({
      reason: "stale_registry",
      remedies: ["Regenerate and deploy the Eval registry."],
    });
  });
});

describe("Eval catalog Current status", () => {
  it("ignores a failing Variant when Current cells and Gates pass", () => {
    const run = {
      definitionFingerprint: "definition-v2",
      status: "complete",
      passed: false,
      cells: [
        { variant: "current", status: "passed" },
        { variant: "cheaper", status: "failed" },
      ],
      gates: {
        passed: false,
        results: [
          { variantName: "current", passed: true },
          { variantName: "cheaper", passed: false },
        ],
      },
    } as const;
    expect(currentArmStatus(run, "definition-v2")).toBe("passed");
  });

  it("reports Current failure and incomplete work truthfully", () => {
    expect(
      currentArmStatus(
        {
          definitionFingerprint: "definition-v2",
          cells: [{ variant: "current", status: "failed" }],
          gates: undefined,
        } as const,
        "definition-v2",
      ),
    ).toBe("failed");
    expect(
      currentArmStatus(
        {
          definitionFingerprint: "definition-v2",
          cells: [{ variant: "current", status: "errored" }],
          gates: undefined,
        } as const,
        "definition-v2",
      ),
    ).toBe("incomplete");
    expect(
      currentArmStatus(
        {
          definitionFingerprint: "definition-v2",
          cells: [{ variant: "current", status: "skipped" }],
          gates: undefined,
        } as const,
        "definition-v2",
      ),
    ).toBe("incomplete");
  });

  it("does not present a passing run from an old definition as Current", () => {
    expect(
      currentArmStatus(
        {
          definitionFingerprint: "definition-v1",
          cells: [{ variant: "current", status: "passed" }],
        },
        "definition-v2",
      ),
    ).toBe("stale");
  });
});
