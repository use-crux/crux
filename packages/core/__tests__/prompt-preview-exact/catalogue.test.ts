import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { prompt } from "../../src/prompt/prompt";
import { configure } from "../../src/runtime/configure";
import { activePromptCatalogue } from "../../src/runtime/prompt-catalogue";
import {
  executeRuntimeBridgeCommand,
  getRuntimeBridgeManifest,
} from "../../src/runtime-bridge";

describe("exact prompt preview catalogue", () => {
  const disposals: Array<() => void> = [];

  afterEach(() => {
    for (const dispose of disposals.splice(0).reverse()) dispose();
    vi.restoreAllMocks();
  });

  it("publishes successful replacement and ignores stale disposal", () => {
    const first = configure({
      prompts: [prompt({ id: "first", system: "first" })],
    });
    disposals.push(first.dispose);
    const firstRevision = activePromptCatalogue().revision;

    const second = configure({
      prompts: [prompt({ id: "second", system: "second" })],
    });
    disposals.push(second.dispose);
    const secondRevision = activePromptCatalogue().revision;
    first.dispose();

    expect(secondRevision).toBeGreaterThan(firstRevision);
    expect(activePromptCatalogue()).toMatchObject({
      revision: secondRevision,
      entries: [{ target: { definitionId: "prompt:second" } }],
    });

    second.dispose();
    expect(activePromptCatalogue()).toMatchObject({
      revision: secondRevision + 1,
      entries: [],
    });
  });

  it("leaves the active catalogue unchanged when configuration fails", () => {
    const active = configure({
      prompts: [prompt({ id: "active", system: "active" })],
    });
    disposals.push(active.dispose);
    const before = activePromptCatalogue();
    const duplicate = prompt({ id: "duplicate", system: "duplicate" });

    expect(() => configure({ prompts: [duplicate, duplicate] })).toThrow(
      /duplicate prompt id/,
    );
    expect(activePromptCatalogue()).toBe(before);
  });

  it("advertises only eligible prompts with none, schema, and raw input", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const registry = configure({
      prompts: [
        prompt({ id: "none", system: "none" }),
        prompt({
          id: "schema",
          input: z.object({ topic: z.string() }),
          system: "schema",
        }),
        prompt({
          id: "raw",
          input: z.object({ value: z.custom<unknown>() }),
          system: "raw",
        }),
        prompt({
          id: "messages",
          messages: () => [{ role: "user", content: "hidden" }],
        }),
      ],
    });
    disposals.push(registry.dispose);

    const capability = getRuntimeBridgeManifest({
      devtools: { bridge: true },
    })?.capabilities.find(
      (candidate) => candidate.command === "prompt.previewExact",
    );

    expect(capability).toMatchObject({
      targets: [
        { definitionId: "prompt:none", input: { mode: "none" } },
        { definitionId: "prompt:raw", input: { mode: "raw" } },
        { definitionId: "prompt:schema", input: { mode: "schema" } },
      ],
    });
    expect(warning).toHaveBeenCalledWith(
      "CRUX_PROMPT_PREVIEW_CATALOGUE_OMITTED",
      expect.objectContaining({
        authoredTargetCount: 4,
        invalidTargetCount: 1,
      }),
    );
    expect(JSON.stringify(warning.mock.calls)).not.toContain("hidden");
  });

  it("omits an over-count capability and its execution authority", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const registry = configure({
      prompts: Array.from({ length: 513 }, (_, index) =>
        prompt({
          id: `bounded-${index.toString().padStart(3, "0")}`,
          system: "x",
        }),
      ),
    });
    disposals.push(registry.dispose);

    const manifest = getRuntimeBridgeManifest({
      devtools: { bridge: true },
    });

    expect(
      manifest?.capabilities.some(
        (candidate) => candidate.command === "prompt.previewExact",
      ),
    ).toBe(false);
    expect(activePromptCatalogue().entries).toHaveLength(513);
    expect(warning).toHaveBeenCalledWith(
      "CRUX_PROMPT_PREVIEW_CATALOGUE_OMITTED",
      expect.objectContaining({
        authoredTargetCount: 513,
        retainedTargetCount: 513,
        capabilityOmitted: true,
      }),
    );

    await expect(
      executeRuntimeBridgeCommand(
        {},
        {
          type: "command.request",
          commandId: "cmd_omitted",
          command: "prompt.previewExact",
          targetId: "prompt:bounded-000",
          catalogueRevision: activePromptCatalogue().revision,
          payload: { input: {} },
          deadlineMs: 1_000,
        },
      ),
    ).rejects.toMatchObject({
      previewError: { code: "target_unavailable" },
    });
  });
});
