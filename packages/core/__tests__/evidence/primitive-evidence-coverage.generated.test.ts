import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CRUX_PRIMITIVE_NAMES } from "../../src/observability";
import { EVIDENCE_ROLES } from "../../src/evidence/roles";
import {
  PRIMITIVE_EVIDENCE_COVERAGE,
  PRIMITIVE_EVIDENCE_COVERAGE_GROUPS,
} from "../../src/project-index";
import {
  renderPrimitiveEvidenceCoverageJson,
  renderPrimitiveEvidenceCoverageMarkdown,
} from "../../src/project-index/primitive-evidence-coverage/render";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const generatedRoot = resolve(
  import.meta.dirname,
  "../../src/project-index/primitive-evidence-coverage/generated",
);
const coverageCheck = process.env.EVIDENCE_COVERAGE_CHECK;

describe("generated primitive evidence coverage", () => {
  it("accepts only the documented validation modes", () => {
    expect([undefined, "structure", "anchors"]).toContain(coverageCheck);
  });

  it("classifies every primitive exactly once with complete bounded metadata", async () => {
    const groupedNames = PRIMITIVE_EVIDENCE_COVERAGE_GROUPS.flatMap((group) =>
      Object.keys(group),
    );
    expect(groupedNames).toHaveLength(new Set(groupedNames).size);
    expect([...groupedNames].sort()).toEqual([...CRUX_PRIMITIVE_NAMES].sort());
    expect(Object.keys(PRIMITIVE_EVIDENCE_COVERAGE).sort()).toEqual(
      [...CRUX_PRIMITIVE_NAMES].sort(),
    );

    for (const [name, row] of Object.entries(PRIMITIVE_EVIDENCE_COVERAGE)) {
      expect(row.name).toBe(name);
      expect(Object.keys(row.roles).sort()).toEqual([...EVIDENCE_ROLES].sort());
      for (const decision of Object.values(row.roles)) {
        expect(decision).toMatch(
          /^(automatic|advanced-custom|blocked|native-planned|not-applicable)$/,
        );
      }
      expect(row.participation).toMatch(
        /^(subject|producer|consumer|none)$/,
      );
      expect(row.nativeEvidence.status).toMatch(
        /^(automatic|blocked|custom-only|partial|planned)$/,
      );
      expect(row.runtimeDurability).toMatch(
        /^(local-durable|core-only|blocked)$/,
      );
      expect(row.otelPolicy).toMatch(/^(closed-allowlist|excluded)$/);
      const automaticRoles = Object.entries(row.roles)
        .filter(([, decision]) => decision === "automatic")
        .map(([role]) => role);
      expect(Object.keys(row.automaticRoles ?? {}).sort()).toEqual(
        automaticRoles.sort(),
      );
      for (const automaticRole of Object.values(row.automaticRoles ?? {})) {
        expect(automaticRole?.producer.trim()).not.toBe("");
        expect(automaticRole?.sourceKinds.length).toBeGreaterThan(0);
        for (const sourceKind of automaticRole?.sourceKinds ?? []) {
          expect(sourceKind.trim()).not.toBe("");
        }
        expect(automaticRole?.conformanceTest.trim()).not.toBe("");
        await expect(
          stat(resolve(repositoryRoot, automaticRole?.conformanceTest ?? "")),
        ).resolves.toBeDefined();
      }
      const blockedRoles = Object.entries(row.roles)
        .filter(([, decision]) => decision === "blocked")
        .map(([role]) => role);
      expect(Object.keys(row.blockedRoles ?? {}).sort()).toEqual(
        blockedRoles.sort(),
      );
      for (const blocker of Object.values(row.blockedRoles ?? {})) {
        expect(blocker).toMatch(
          /^https:\/\/github\.com\/use-crux\/crux\/issues\/\d+/,
        );
      }
      expect(row.interimBehavior.trim()).not.toBe("");
      expect(row.owner).toMatch(
        /^https:\/\/github\.com\/use-crux\/crux\/issues\//,
      );
      expect(row.conformanceTest.trim()).not.toBe("");
      expect(row.devtoolsRenderer.trim()).not.toBe("");
      await expect(
        stat(resolve(repositoryRoot, row.conformanceTest)),
      ).resolves.toBeDefined();
      if (
        row.nativeEvidence.status === "planned" ||
        row.nativeEvidence.status === "blocked" ||
        row.nativeEvidence.status === "partial"
      ) {
        expect(row.nativeEvidence.blockers?.length).toBeGreaterThan(0);
      }
    }
  });

  it("matches the committed JSON and human-readable artifacts", async () => {
    const rows = Object.values(PRIMITIVE_EVIDENCE_COVERAGE);
    const [json, markdown] = await Promise.all([
      readFile(
        resolve(generatedRoot, "primitive-evidence-coverage.json"),
        "utf8",
      ),
      readFile(
        resolve(generatedRoot, "primitive-evidence-coverage.md"),
        "utf8",
      ),
    ]);
    expect(json).toBe(renderPrimitiveEvidenceCoverageJson(rows));
    expect(markdown).toBe(renderPrimitiveEvidenceCoverageMarkdown(rows));
  });

  it("does not claim an automatic recovery producer before Effects #196", () => {
    expect(
      Object.values(PRIMITIVE_EVIDENCE_COVERAGE).filter(
        (row) => row.roles.recovery === "automatic",
      ),
    ).toEqual([]);
  });

  it("classifies shipped tool approval authority as automatic", () => {
    expect(PRIMITIVE_EVIDENCE_COVERAGE["tool.approval"].roles.authority).toBe(
      "automatic",
    );
  });

  it.runIf(coverageCheck === "anchors")(
    "resolves every conformance and renderer anchor",
    async () => {
      for (const row of Object.values(PRIMITIVE_EVIDENCE_COVERAGE)) {
        await expect(
          stat(resolve(repositoryRoot, row.conformanceTest)),
        ).resolves.toBeDefined();
        await expect(
          stat(resolve(repositoryRoot, row.devtoolsRenderer)),
        ).resolves.toBeDefined();
        for (const role of Object.values(row.automaticRoles ?? {})) {
          await expect(
            stat(resolve(repositoryRoot, role?.conformanceTest ?? "")),
          ).resolves.toBeDefined();
        }
      }
    },
  );
});
