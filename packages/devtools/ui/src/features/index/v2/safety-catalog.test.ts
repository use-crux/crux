import { describe, expect, it } from "vitest";
import {
  projectOperationSafetyCatalog,
  projectSafetyPolicyCatalog,
} from "./safety-catalog";

describe("Safety Catalog projection", () => {
  it("projects ordered boundaries, media strategy, and operation targets", () => {
    const view = projectSafetyPolicyCatalog({
      id: "guardrail:portable-media",
      name: "portableMedia",
      kind: "guardrail",
      facts: {
        boundary: "user.input.media",
        boundaries: ["user.input.media", "model.output.media"],
        strategy: {
          kind: "media",
          config: {
            mediaTypes: { allow: ["image/png"] },
            action: "strip",
          },
        },
      },
      targets: [
        {
          id: "media.operation:cover",
          name: "cover",
          kind: "media.operation",
        },
      ],
    });

    expect(view).toEqual({
      kind: "guardrail",
      id: "guardrail:portable-media",
      name: "portableMedia",
      boundaries: ["user.input.media", "model.output.media"],
      strategy: {
        kind: "media",
        action: "strip",
        config: {
          mediaTypes: { allow: ["image/png"] },
          action: "strip",
        },
      },
      targets: [
        {
          id: "media.operation:cover",
          name: "cover",
          kind: "media.operation",
        },
      ],
    });
  });

  it("projects attached policies for completed media operations", () => {
    const policy = projectSafetyPolicyCatalog({
      id: "guardrail:generated-media",
      name: "generatedMedia",
      kind: "guardrail",
      facts: {
        boundary: "model.output.media",
        strategy: { kind: "media", config: { action: "block" } },
      },
    })!;

    expect(
      projectOperationSafetyCatalog({
        id: "media.operation:cover",
        name: "cover",
        kind: "media.operation",
        policies: [policy],
        hasSafetyOptions: true,
      }),
    ).toEqual({
      kind: "media.operation",
      id: "media.operation:cover",
      name: "cover",
      policies: [policy],
      hasSafetyOptions: true,
    });
  });
});
