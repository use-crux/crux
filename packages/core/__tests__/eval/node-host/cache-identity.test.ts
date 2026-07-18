import { describe, expect, it } from "vitest";
import { createTaskEvidenceIdentity } from "../../../src/eval/internal/identity";
import { projectRemoteHostContractFingerprint } from "../../../src/eval/node/coordinator";

describe("remote Eval evidence identity", () => {
  it("misses across locally selected deployments", () => {
    const identity = (deploymentId: string, privacyFingerprint = "privacy-default") =>
      createTaskEvidenceIdentity({
        evalId: "support",
        caseId: "refund",
        input: { question: "refund" },
        variant: "current",
        trial: 0,
        managedTaskFingerprint: "registry-and-source-v1",
        adapterFingerprint: "adapter-v1",
        hostContractFingerprint: projectRemoteHostContractFingerprint({
          deploymentId,
          requiredHostCapabilities: ["record-store"],
          privacyFingerprint,
        }),
        occurrence: "root",
      }).key;

    expect(identity("deployment-a")).not.toBe(identity("deployment-b"));
    expect(identity("deployment-a", "privacy-a")).not.toBe(
      identity("deployment-a", "privacy-b"),
    );
  });
});
