import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { toCanonicalJsonSchema } from "../../src/adapter/structured-output/canonical-schema";
import { prompt } from "../../src/prompt/prompt";
import { getRuntimeBridgeManifest } from "../../src/runtime-bridge";
import { promptPreviewCapability } from "../../src/runtime-bridge/prompt-preview/catalogue";
import {
  PROMPT_PREVIEW_MAX_CAPABILITY_BYTES,
  PROMPT_PREVIEW_MAX_SCHEMA_BYTES,
  compactJson,
} from "../../src/runtime-bridge/prompt-preview/limits";
import { configure } from "../../src/runtime/configure";
import type { ActivePromptCatalogueEntry } from "../../src/runtime/prompt-catalogue";

describe("exact prompt preview catalogue bounds", () => {
  const disposals: Array<() => void> = [];

  afterEach(() => {
    for (const dispose of disposals.splice(0).reverse()) dispose();
  });

  it("omits every canonical-ID collision while retaining other targets", () => {
    disposals.push(
      configure({
        prompts: [
          prompt({ id: "a b", system: "first collision" }),
          prompt({ id: "a@b", system: "second collision" }),
          prompt({ id: "retained", system: "retained" }),
        ],
      }).dispose,
    );

    expect(currentCapability()).toMatchObject({
      targets: [{ definitionId: "prompt:retained" }],
    });
  });

  it("accepts an exact schema-byte boundary and omits one-byte overflow", () => {
    const schemaBytes = (descriptionLength: number) => {
      const value = prompt({
        id: "measure",
        input: z.object({
          value: z.string().describe("x".repeat(descriptionLength)),
        }),
        system: "measure",
      });
      return compactJson(toCanonicalJsonSchema(value.inputSchema!)).bytes;
    };
    const exactLength = 1 + PROMPT_PREVIEW_MAX_SCHEMA_BYTES - schemaBytes(1);
    expect(schemaBytes(exactLength)).toBe(PROMPT_PREVIEW_MAX_SCHEMA_BYTES);
    expect(schemaBytes(exactLength + 1)).toBe(
      PROMPT_PREVIEW_MAX_SCHEMA_BYTES + 1,
    );
    disposals.push(
      configure({
        prompts: [
          prompt({
            id: "schema-exact",
            input: z.object({
              value: z.string().describe("x".repeat(exactLength)),
            }),
            system: "exact",
          }),
          prompt({
            id: "schema-overflow",
            input: z.object({
              value: z.string().describe("x".repeat(exactLength + 1)),
            }),
            system: "overflow",
          }),
        ],
      }).dispose,
    );

    expect(currentCapability()).toMatchObject({
      targets: [{ definitionId: "prompt:schema-exact" }],
    });
  });

  it("accepts exact capability bytes and rejects one-byte overflow", () => {
    const entries = exactCapabilityEntries();
    const exact = promptPreviewCapability(1, entries);
    expect(exact).toBeDefined();
    expect(compactJson(exact).bytes).toBe(PROMPT_PREVIEW_MAX_CAPABILITY_BYTES);
    const adjustable = entries.findLast(
      (entry) => (entry.target.description?.length ?? 0) < 4_096,
    )!;
    const overflow = entries.map((entry) =>
      entry === adjustable
        ? {
            ...entry,
            target: {
              ...entry.target,
              description: `${entry.target.description ?? ""}x`,
            },
          }
        : entry,
    );
    expect(promptPreviewCapability(1, overflow)).toBeUndefined();
  });
});

function currentCapability() {
  return getRuntimeBridgeManifest({
    devtools: { bridge: true },
  })?.capabilities.find(
    (candidate) => candidate.command === "prompt.previewExact",
  );
}

function exactCapabilityEntries(): ActivePromptCatalogueEntry[] {
  const runtimePrompt = prompt({ id: "runtime", system: "runtime" });
  const entries: ActivePromptCatalogueEntry[] = Array.from(
    { length: 512 },
    (_, index) => ({
      prompt: runtimePrompt,
      target: {
        definitionId: `prompt:bounded-${index.toString().padStart(3, "0")}`,
        kind: "prompt",
        name: `bounded-${index.toString().padStart(3, "0")}`,
        input: { mode: "none" },
      },
    }),
  );
  let remaining =
    PROMPT_PREVIEW_MAX_CAPABILITY_BYTES -
    compactJson({
      command: "prompt.previewExact",
      catalogueRevision: 1,
      targets: entries.map((entry) => entry.target),
    }).bytes;
  const descriptionOverhead = capabilityDescriptionDelta(entries, 0) - 1;
  let described = 0;
  while (remaining >= descriptionOverhead + 1) {
    const length = Math.min(4_096, remaining - descriptionOverhead);
    entries[described] = withDescription(entries[described]!, length);
    remaining -= descriptionOverhead + length;
    described += 1;
  }
  if (remaining > 0) {
    const reduction = descriptionOverhead + 1 - remaining;
    const previousLength = entries[described - 1]!.target.description!.length;
    entries[described - 1] = withDescription(
      entries[described - 1]!,
      previousLength - reduction,
    );
    entries[described] = withDescription(entries[described]!, 1);
  }
  return entries;
}

function capabilityDescriptionDelta(
  entries: readonly ActivePromptCatalogueEntry[],
  index: number,
): number {
  const base = compactJson(entries[index]!.target).bytes;
  return (
    compactJson({
      ...entries[index]!.target,
      description: "x",
    }).bytes - base
  );
}

function withDescription(
  entry: ActivePromptCatalogueEntry,
  length: number,
): ActivePromptCatalogueEntry {
  return {
    ...entry,
    target: { ...entry.target, description: "x".repeat(length) },
  };
}
