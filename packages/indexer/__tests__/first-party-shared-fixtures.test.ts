import { describe, expect, it } from "vitest";
import { readStaticIndexRuntimeSharedFixture } from "../src/contracts/fixtures";
import { builtInIndexRuleDescriptors } from "../src/indexer/lints/rules";
import { indexRelationPolicies } from "../src/indexer/relations";

describe("first-party shared static index fixtures", () => {
  it("validates shared static syntax, relation, and rule fixture files", () => {
    const syntax = readStaticIndexRuntimeSharedFixture("static-syntax-records");
    expect(syntax.records).toHaveLength(1);
    expect(syntax.records[0]).toMatchObject({
      schemaVersion: 1,
      frontend: { name: "oxc-rust" },
      file: "/repo/src/contract.ts",
      matches: [
        expect.objectContaining({
          kind: "call",
          variableName: "contractPrompt",
        }),
      ],
      nativeFacts: [
        expect.objectContaining({
          matchIndex: 0,
          replaces: [
            { extension: "@use-crux/indexer/crux-core", extractor: "prompt" },
          ],
        }),
      ],
    });

    const relationSpecs = readStaticIndexRuntimeSharedFixture("relation-specs");
    const relationPoliciesByType = new Map(
      indexRelationPolicies.map((policy) => [policy.type, policy]),
    );
    for (const policy of relationSpecs.policies) {
      expect(relationPoliciesByType.get(policy.type)).toMatchObject(policy);
    }

    const ruleDescriptors =
      readStaticIndexRuntimeSharedFixture("rule-descriptors");
    const builtInDescriptors = builtInIndexRuleDescriptors();

    expect(
      ruleDescriptors.descriptors.map((descriptor) => descriptor.id),
    ).toEqual(builtInDescriptors.map((descriptor) => descriptor.id));
    expect(ruleDescriptors.descriptors).toEqual(builtInDescriptors);
  });

  it("audits native coverage identities against required parity fixture classes", () => {
    const coverage = readStaticIndexRuntimeSharedFixture(
      "primitive-coverage-identities",
    );
    const coveredExtractors = coverage.identities
      .map((identity) => identity.extractor)
      .sort();

    expect(coverage.requiredFixtureClasses).toEqual([
      "definitions",
      "relations",
      "sourceRefs",
      "diagnostics",
      "dependencies",
      "lints",
      "sources",
      "sourceGraph",
      "runtimeMetadata",
      "degradedBehavior",
    ]);
    expect(
      coverage.identities.map((identity) => identity.extractor).sort(),
    ).toEqual(coveredExtractors);
    for (const identity of coverage.identities) {
      const media =
        identity.extractor === "media.operation" ||
        identity.extractor === "ingest.source";
      const mcp = identity.extractor === "mcp.server";
      expect(identity.extension).toBe(
        media
          ? "@use-crux/indexer/crux-core-media"
          : mcp
            ? "@use-crux/indexer/crux-core-mcp"
          : "@use-crux/indexer/crux-core",
      );
      expect(identity.family).toBe(identity.extractor);
      expect(identity.nativeCovered).toBe(true);
      expect(
        identity.parityFixtures.positive,
        `${identity.extractor} positive parity fixture`,
      ).toBe(identity.fixtureClasses.definitions);
      expect(
        identity.parityFixtures.negative,
        `${identity.extractor} negative parity fixture`,
      ).toBe(
        media
          ? "media-native-static.test.ts"
          : mcp
            ? "mcp-native-static.test.ts"
            : identity.extractor === "evidence.record"
              ? "evidence-record-native-static.test.ts"
          : "first-party-native-negative-fixtures.test.ts",
      );
      for (const fixtureClass of coverage.requiredFixtureClasses) {
        expect(
          identity.fixtureClasses[fixtureClass],
          `${identity.extractor} missing ${fixtureClass}`,
        ).toMatch(/\.(ts|json)$/);
      }
      expect(
        Object.values(identity.fixtureClasses),
        `${identity.extractor} generic static protocol anchor`,
      ).not.toContain("static-index-protocol.json");
    }
  });
});
