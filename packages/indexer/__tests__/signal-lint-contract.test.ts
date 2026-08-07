import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SIGNAL_TRANSPORT_BINDING_LIVE_FIELDS,
  type IndexRuleDescriptor,
} from "@use-crux/core/project-index";
import { builtInIndexRuleDescriptors } from "../src/indexer/lints/rules";

const signalRules = [
  "signal.provider.unstable_identity",
  "signal.transportBinding.unstable_identity",
  "signal.transportBinding.live_value",
] as const;

describe("Signal transport lint descriptor contract", () => {
  it("exports the exact live binding field contract", () => {
    expect(SIGNAL_TRANSPORT_BINDING_LIVE_FIELDS).toEqual([
      "request",
      "client",
      "credential",
      "credentials",
      "socket",
      "callback",
      "handle",
      "poll",
      "open",
      "onEvent",
      "secret",
      "token",
      "password",
      "apiKey",
    ]);
  });

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
      "signal.provider.unstable_identity": ["error", "index"],
      "signal.transportBinding.unstable_identity": ["error", "index"],
      "signal.transportBinding.live_value": ["error", "index"],
    };

    for (const descriptors of [builtInIndexRuleDescriptors(), native]) {
      expect(
        Object.fromEntries(
          descriptors
            .filter((descriptor) =>
              signalRules.some((ruleId) => ruleId === descriptor.id),
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
