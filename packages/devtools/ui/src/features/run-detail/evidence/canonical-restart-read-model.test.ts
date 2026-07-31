import { describe, expect, it } from "vitest";
import type { EvidenceRole } from "@use-crux/core/evidence";
import fixture from "./fixtures/canonical-restart-read-model.json";
import { projectEvidenceRole } from "./presentation";
import { shouldRenderGenericEvidence } from "./representation";
import type {
  EvidenceApiInspectResult,
  EvidenceApiRoleResult,
} from "./types";

const roles = [
  "intent",
  "authority",
  "change",
  "verification",
  "recovery",
] as const satisfies readonly EvidenceRole[];

describe("canonical restart read model", () => {
  it("projects the exact Local response once without rederiving durable truth", () => {
    const response = fixture as unknown as EvidenceApiInspectResult;
    const projected = roles.map((role) =>
      projectEvidenceRole(
        response.roles[role] as EvidenceApiRoleResult<EvidenceRole>,
      ),
    );

    expect(
      projected.map((role) => ({
        role: role.role,
        status: role.status.value,
        activeRecordCount: role.activeRecordCount,
        conclusion: role.conclusion,
        conflicting: role.conflicting,
      })),
    ).toEqual([
      {
        role: "intent",
        status: "redacted",
        activeRecordCount: 1,
        conclusion: undefined,
        conflicting: false,
      },
      {
        role: "authority",
        status: "present",
        activeRecordCount: 2,
        conclusion: undefined,
        conflicting: true,
      },
      {
        role: "change",
        status: "redacted",
        activeRecordCount: 1,
        conclusion: "applied",
        conflicting: false,
      },
      {
        role: "verification",
        status: "present",
        activeRecordCount: 2,
        conclusion: undefined,
        conflicting: true,
      },
      {
        role: "recovery",
        status: "not-yet-recorded",
        activeRecordCount: 0,
        conclusion: undefined,
        conflicting: false,
      },
    ]);

    const activeRecords = projected.flatMap((role) => role.records);
    const represented = new Set(activeRecords.map((record) => record.id));
    expect(activeRecords).toHaveLength(6);
    expect(represented.size).toBe(activeRecords.length);
    for (const record of activeRecords) {
      expect(
        shouldRenderGenericEvidence({
          surface: "generic-collection",
          key: record.id,
          representedKeys: represented,
        }),
      ).toBe(false);
    }
  });

  it("preserves retention, policy, history, conflict, and late provenance", () => {
    const response = fixture as unknown as EvidenceApiInspectResult;
    const intent = projectEvidenceRole(response.roles.intent);
    const authority = projectEvidenceRole(response.roles.authority);
    const change = projectEvidenceRole(response.roles.change);
    const verification = projectEvidenceRole(response.roles.verification);

    expect(intent.records[0]?.payload.label).toBe("Payload expired");
    expect(change.records[0]?.payload.label).toBe("Removed by policy");
    expect(authority.history.map((record) => record.id)).toEqual([
      "evidence_0000000000002001",
    ]);
    expect(verification.history.map((record) => record.id)).toEqual([
      "evidence_0000000000004001",
    ]);
    expect(
      verification.records.map((record) => record.renderer.id),
    ).toEqual(["evaluation", "evaluation"]);
    expect(
      authority.records.map((record) => record.renderer.id),
    ).toEqual(["approval", "approval"]);
    expect(
      verification.records.every(
        (record) =>
          record.acceptedAfterTerminal?.label ===
          "Recorded after this span had ended.",
      ),
    ).toBe(true);
  });
});
