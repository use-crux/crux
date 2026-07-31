import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  config,
  context,
  offloadable,
  preview,
  prompt,
  summarizable,
} from "../src";
import { agent } from "../src/agent";
import { inMemoryRecordStore } from "../src/storage";

describe.sequential("request preview", () => {
  it("returns fit and over-limit outcomes while programming errors still throw", async () => {
    const reply = agent({
      id: "preview-agent",
      model: "preview-model",
      prompt: prompt({
        id: "preview-prompt",
        input: z.object({ message: z.string() }),
        system: "Answer precisely.",
        prompt: ({ input }) => input.message,
      }),
    });

    await expect(
      preview(reply, { input: { message: "hello" } }),
    ).resolves.toMatchObject({
      status: "fits",
      model: "preview-model",
      measurement: "conservative",
      adaptations: [],
      diagnostics: [],
    });
    await expect(
      preview(reply, {
        input: { message: "hello" },
        inputBudget: { max: 1 },
      }),
    ).resolves.toMatchObject({
      status: "over-limit",
      model: "preview-model",
      maxInputTokens: 1,
    });
    await expect(
      preview(reply, { input: { message: 42 } as never }),
    ).rejects.toThrow("Input validation failed");
  });

  it("reports unprepared prospective adaptations without producing artifacts or retained work", async () => {
    const records = inMemoryRecordStore();
    const put = vi.spyOn(records, "put");
    const create = vi.spyOn(records, "create");
    const retain = vi.fn();
    const installation = config({
      host: {
        kind: "preview-test",
        invocationScope: false,
        supportsInline: true,
        retain,
      },
      storage: { records },
    });
    const primary = context({
      id: "preview-source",
      system: "Canonical private source. ".repeat(300),
    });
    const target = prompt({
      id: "preview-representations",
      use: [
        offloadable(
          summarizable(primary),
        ),
      ],
      prompt: "Use the source.",
    });

    try {
      const result = await preview(target, {
        model: "preview-model",
        inputBudget: { max: 50 },
      });

      expect(result.status).toBe("unknown");
      expect(result.adaptations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            contributor: "preview-source",
            state: "unprepared",
          }),
        ]),
      );
      expect(put).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
      expect(retain).not.toHaveBeenCalled();
      expect(
        (await records.list("crux:request-summary:v1:")).entries,
      ).toHaveLength(0);
      expect(
        (await records.list("crux:request-offload:v1:")).entries,
      ).toHaveLength(0);
    } finally {
      installation.dispose();
    }
  });
});
