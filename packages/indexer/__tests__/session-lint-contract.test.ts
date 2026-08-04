import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { IndexRuleDescriptor } from "@use-crux/core/project-index";
import { builtInIndexRuleDescriptors } from "../src/indexer/lints/rules";

const sessionRules = [
  "session.ambiguous_construction",
  "session.invalid_target",
  "session.non_owner_thread_mutation",
  "session.shared_agent_thread",
  "session.unstable_identity",
] as const;

describe("Session lint descriptor contract", () => {
  it("keeps exact built-in descriptor codes and severities in both mirrors", async () => {
    const native = JSON.parse(
      await readFile(
        join(
          process.cwd(),
          "../../crates/lints/src/builtin_rule_descriptors.json",
        ),
        "utf8",
      ),
    ) as readonly IndexRuleDescriptor[];
    const expected = {
      "session.ambiguous_construction": ["error", "index"],
      "session.invalid_target": ["error", "index"],
      "session.non_owner_thread_mutation": ["error", "semantic"],
      "session.shared_agent_thread": ["warning", "index"],
      "session.unstable_identity": ["error", "index"],
    };

    for (const descriptors of [builtInIndexRuleDescriptors(), native]) {
      expect(
        Object.fromEntries(
          descriptors
            .filter((descriptor) =>
              sessionRules.some((ruleId) => ruleId === descriptor.id),
            )
            .map((descriptor) => [
              descriptor.id,
              [descriptor.severity, descriptor.phase],
            ]),
        ),
      ).toEqual(expected);
    }
  });
});
