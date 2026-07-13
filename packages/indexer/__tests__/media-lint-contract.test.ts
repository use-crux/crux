import { describe, expect, it } from "vitest";
import { builtInIndexRuleDescriptors } from "../src/indexer/lints/rules";

const mediaRules = {
  "media.unsupported-capability": "error",
  "media.invalid-provider-file": "error",
  "media.asset-ref-not-hydrated": "error",
  "media.missing-derivation": "warning",
  "media.missing-attribution": "warning",
  "media.output-discarded": "warning",
  "media.raw-retention": "warning",
} as const;

describe("media lint contract", () => {
  it("publishes all deterministic media rules with remediation metadata", () => {
    const descriptors = new Map(
      builtInIndexRuleDescriptors().map((descriptor) => [
        descriptor.id,
        descriptor,
      ]),
    );

    for (const [ruleId, severity] of Object.entries(mediaRules)) {
      const descriptor = descriptors.get(ruleId);
      expect(descriptor?.severity, ruleId).toBe(severity);
      expect(descriptor?.fidelity, ruleId).toBe("safe");
      expect(descriptor?.requires, ruleId).toEqual(
        expect.arrayContaining(["definitions"]),
      );
      expect(descriptor?.impact, ruleId).toBeTruthy();
      expect(descriptor?.fixes?.[0]?.description, ruleId).toBeTruthy();
    }
  });
});
