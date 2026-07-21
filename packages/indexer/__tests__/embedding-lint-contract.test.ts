import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { builtInIndexRuleDescriptors } from "../src/indexer/lints/rules";

const embeddingRules = [
  "embedding.unsupported-modality",
  "embedding.namespace-identity-mismatch",
  "embedding.sparse-media",
] as const;

describe("embedding lint contract", () => {
  it("publishes every conclusive embedding rule with remediation metadata", () => {
    const descriptors = new Map(
      builtInIndexRuleDescriptors().map((descriptor) => [
        descriptor.id,
        descriptor,
      ]),
    );

    for (const ruleId of embeddingRules) {
      const descriptor = descriptors.get(ruleId);
      expect(descriptor?.severity, ruleId).toBe("error");
      expect(descriptor?.phase, ruleId).toBe("semantic");
      expect(descriptor?.fidelity, ruleId).toBe("safe");
      expect(descriptor?.requires, ruleId).toEqual(
        expect.arrayContaining(["definitions", "sources"]),
      );
      expect(descriptor?.impact, ruleId).toBeTruthy();
      expect(descriptor?.fixes?.[0]?.description, ruleId).toBeTruthy();
    }
  });

  it("keeps the Rust-owned descriptor manifest authoritative", () => {
    const native = JSON.parse(
      readFileSync(
        join(
          process.cwd(),
          "../../crates/lints/src/builtin_rule_descriptors.json",
        ),
        "utf8",
      ),
    ) as readonly { readonly id: string }[];
    const published = builtInIndexRuleDescriptors().filter((descriptor) =>
      descriptor.id.startsWith("embedding."),
    );
    expect(
      native.filter((descriptor) => descriptor.id.startsWith("embedding.")),
    ).toEqual(published);
  });
});
