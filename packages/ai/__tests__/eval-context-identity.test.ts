import type { LanguageModel } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { context, match, prompt, when } from "@use-crux/core";
import { getEvalTaskDescriptorForInternalUse } from "@use-crux/core/eval/internal/task";
import { skill } from "@use-crux/core/skill";
import { createCruxAi, stableModel } from "../src";

const model = stableModel({
  provider: "test",
  modelId: "leaf",
  specificationVersion: "v3",
} as unknown as LanguageModel);

function project(value: ReturnType<typeof prompt>) {
  const task = createCruxAi().generate.task(value, { model });
  return getEvalTaskDescriptorForInternalUse(task).projectIdentity({
    phase: "plan",
    input: {},
    overrides: {},
  });
}

describe("pure prompt context identity", () => {
  it("projects static contexts as authored data without rendering them", () => {
    const rules = context({
      id: "rules",
      description: "Stable support rules",
      system: "Never invent a refund policy.",
      priority: 80,
      cache: true,
    });

    expect(project(prompt({ use: [rules], prompt: "Answer." }))).toMatchObject({
      reusable: true,
      fingerprintMaterial: {
        prompt: {
          contexts: [
            {
              kind: "context",
              id: "rules",
              description: "Stable support rules",
              system: {
                kind: "static",
                value: "Never invent a refund policy.",
              },
              priority: 80,
              providerCache: true,
            },
          ],
        },
      },
    });
  });

  it("fails closed for dynamic Context closure state", () => {
    let calls = 0;
    let prefix = "Locale";
    const facts = context({
      id: "facts",
      input: z.object({ locale: z.string() }),
      system: ({ input }) => {
        calls += 1;
        return `${prefix}: ${input.locale}`;
      },
      when: () => {
        calls += 1;
        return true;
      },
      tools: {
        lookup: {
          description: "Describe a known fact",
          inputSchema: z.object({ id: z.string() }),
        },
      },
    });

    const first = project(prompt({ use: [facts], prompt: "Answer." }));
    prefix = "Language";
    const second = project(prompt({ use: [facts], prompt: "Answer." }));

    expect(first).toEqual({
      reusable: false,
      reason: "untracked_external_dependency",
    });
    expect(second).toEqual(first);
    expect(calls).toBe(0);
  });

  it("fails closed for conditional and match selection callbacks", () => {
    let selections = 0;
    const research = context({ system: "Research carefully." });
    const concise = context({ system: "Be concise." });
    const fallback = context({ system: "Use the default style." });
    const use = [
      when(
        () => {
          selections += 1;
          return true;
        },
        concise,
      ),
      match({
        on: () => {
          selections += 1;
          return "research" as const;
        },
        cases: { research, concise: [concise, research] },
        default: fallback,
      }),
    ] as const;

    expect(project(prompt({ use, prompt: "Answer." }))).toEqual({
      reusable: false,
      reason: "untracked_external_dependency",
    });
    expect(selections).toBe(0);
  });

  it("projects fully loaded skill data", () => {
    const tone = skill.inline({
      id: "tone",
      description: "House tone",
      instructions: "Write warmly.",
      references: { "examples.md": "A warm example." },
    });

    expect(project(prompt({ use: [tone], prompt: "Answer." }))).toMatchObject({
      reusable: true,
      fingerprintMaterial: {
        prompt: {
          contexts: [
            {
              kind: "skill",
              id: "tone",
              instructions: "Write warmly.",
              references: [
                { name: "examples.md", content: "A warm example." },
              ],
            },
          ],
        },
      },
    });
  });

  it("fails closed for executable and input-produced context tools", () => {
    const executableTool = prompt({
      prompt: "Answer.",
      tools: {
        mutate: {
          inputSchema: z.object({ value: z.string() }),
          execute: async () => "changed",
        },
      },
    });
    const dynamicTools = context({
      input: z.object({ enabled: z.boolean() }),
      system: "Tools",
      tools: () => ({
        lookup: { inputSchema: z.object({ id: z.string() }) },
      }),
    });

    expect(project(executableTool)).toEqual({
      reusable: false,
      reason: "untracked_external_dependency",
    });
    expect(project(prompt({ use: [dynamicTools], prompt: "Answer." }))).toEqual(
      {
        reusable: false,
        reason: "untracked_external_dependency",
      },
    );
  });

  it("fails closed for memoized contexts", () => {
    const memoized = context({
      id: "remote-facts",
      input: z.object({ topic: z.string() }),
      system: ({ input }) => input.topic,
      memo: { ttl: 60_000 },
    });

    expect(project(prompt({ use: [memoized], prompt: "Answer." }))).toEqual({
      reusable: false,
      reason: "untracked_external_dependency",
    });
  });

  it("fails closed when prompt config contains an unprojected future field", () => {
    const futurePrompt = prompt({
      id: "future",
      prompt: "Answer.",
      futureExecutionMode: "remote",
    } as never);

    expect(project(futurePrompt)).toEqual({
      reusable: false,
      reason: "identity_unavailable",
    });
  });

  it("fails closed for a lazy skill that still needs external loading", () => {
    const lazy = {
      _tag: "Skill",
      id: "remote",
      description: "Remote instructions",
      instructions: "",
      references: [],
      meta: { name: "remote", description: "Remote instructions" },
      _loaded: false,
      _load: async () => {},
      dump: () => "",
    };

    expect(
      project(prompt({ use: [lazy as never], prompt: "Answer." })),
    ).toEqual({
      reusable: false,
      reason: "untracked_external_dependency",
    });
  });
});
