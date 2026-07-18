import { describe, expect, it } from "vitest";
import { costAdmissionMessage } from "./cost-message";

describe("Eval coordinator cost diagnostics", () => {
  it("lists normalized missing pricing keys and their remedy", () => {
    expect(
      costAdmissionMessage("support", "unknown_cost_under_cap", [
        {
          estimate: {
            kind: "unknown",
            missingPricingKeys: ["gpt-5", "claude-sonnet"],
            remedy: "Configure experimental.eval.pricing.",
          },
        },
      ]),
    ).toContain(
      "Missing pricing keys: claude-sonnet, gpt-5. Configure experimental.eval.pricing.",
    );
  });
});
