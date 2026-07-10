import { describe, expect, it } from "vitest";
import { z } from "zod";
import { compilePrompt } from "../../src/resolver/compile";
import { context, when } from "../../src/prompt/context";
import { contributor } from "../../src/prompt/contributor";
import { createResolverFakes, staticTokenizer } from "../../src/resolver/fakes";
import type { PromptConfig } from "../../src/prompt/prompt-types";
import type { SkillEntry } from "../../src/prompt/context-types";

type AnyConfig = PromptConfig<
  z.ZodType,
  z.ZodType | undefined,
  readonly never[]
>;

function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function inlineSkill(id: string): SkillEntry {
  return {
    _tag: "Skill",
    id,
    description: `${id} skill`,
    instructions: `Use ${id}.`,
    references: [],
    meta: { name: id, description: `${id} skill` },
    dump: () => `Use ${id}.`,
  };
}

function fullFeatureConfig(): AnyConfig {
  const memoized = context({
    id: "memoized-context",
    input: z.object({ topic: z.string() }),
    system: ({ input }) => `memoized ${input.topic}`,
    memo: { ttl: 60_000 },
  });
  const bundled = contributor({
    id: "bundle",
    contribute: () => ({
      use: [context({ id: "nested", system: "nested contribution" })],
      tools: { lookup: "tool" },
    }),
  });
  return {
    id: "inspect-quiet",
    input: z.object({ topic: z.string() }),
    system: "system identity",
    use: [
      inlineSkill("writing"),
      memoized,
      bundled,
      when(
        () => false,
        context({ id: "excluded", system: "excluded contribution" }),
      ),
    ],
  };
}

function warningConfig(): AnyConfig {
  const cached = context({
    id: "cached-warning-context",
    system: "cached prefix contribution",
    cache: true,
  });

  return {
    id: "inspect-warning-fixture",
    input: z.object({
      title: z.string(),
      profile: z.object({ bio: z.string() }),
    }),
    system: ({ input }) => `dynamic ${input.title}`,
    use: [cached],
  };
}

describe("inspect quiet mode", () => {
  it("inspect emits zero spans, artifacts, events and diagnostics", async () => {
    const fakes = createResolverFakes({
      tokenizer: staticTokenizer(wordCount),
    });

    const inspection = await compilePrompt(fullFeatureConfig(), {
      ports: fakes.ports,
    }).inspect({
      input: { topic: "billing" },
      tokenBudget: 8,
    });

    expect(inspection.system.total).toContain("system identity");
    expect(inspection.system.parts.map((part) => part.source)).toContain(
      "context:memoized-context",
    );
    expect(inspection.excludedContexts).toEqual([
      { source: "context:excluded", reason: "when() predicate returned false" },
    ]);
    expect(fakes.observability.scopes).toHaveLength(0);
    expect(fakes.observability.artifacts).toHaveLength(0);
    expect(fakes.instrumentation.events).toHaveLength(0);
    expect(fakes.diagnostics.warnings).toHaveLength(0);
  });

  it("resolve emission unchanged", async () => {
    const fakes = createResolverFakes({
      tokenizer: staticTokenizer(wordCount),
    });

    await compilePrompt(fullFeatureConfig(), { ports: fakes.ports }).resolve({
      input: { topic: "billing" },
      tokenBudget: 8,
    });

    expect(fakes.observability.scopes.map((scope) => scope.primitive)).toEqual([
      "prompt.resolve",
      "context.predicate",
      "context.resolve",
      "context.resolve",
      "context.resolve",
    ]);
    expect(
      fakes.observability.artifacts.map((artifact) => artifact.record.kind),
    ).toEqual([
      "input",
      "context.contribution",
      "context.contribution",
      "context.contribution",
      "context.contribution",
      "context.contribution",
      "prompt.budget",
    ]);
    expect(fakes.instrumentation.events).toEqual([
      {
        kind: "miss",
        contextId: "memoized-context",
        cacheKey: 'cache:ctx:memoized-context:{"topic":"billing"}',
        resolutionMs: 0,
      },
    ]);
    expect(fakes.diagnostics.warnings).toHaveLength(0);
  });

  it("inspect suppresses diagnostics that resolve emits", async () => {
    const inspectFakes = createResolverFakes({
      policy: { autoEscape: true },
      tokenizer: staticTokenizer((text) => text.length),
    });
    const resolveFakes = createResolverFakes({
      policy: { autoEscape: true },
      tokenizer: staticTokenizer((text) => text.length),
    });
    const input = {
      title: "<title>",
      profile: { bio: "<nested>" },
    };

    await compilePrompt(warningConfig(), { ports: inspectFakes.ports }).inspect(
      {
        input,
        tokenBudget: 3,
      },
    );
    await compilePrompt(warningConfig(), { ports: resolveFakes.ports }).resolve(
      {
        input,
        tokenBudget: 3,
      },
    );

    expect(inspectFakes.diagnostics.warnings).toEqual([]);
    expect(
      resolveFakes.diagnostics.warnings.map((warning) => warning.message),
    ).toEqual([
      'auto-escape: input field "profile" contains nested string values; auto-escape covers top-level strings only. Escape nested content explicitly or restructure the input.',
      'prompt "inspect-warning-fixture": contexts request provider caching but the prompt-level system is dynamic; content before a cache breakpoint must be byte-stable. Make `system` static or move dynamic parts into an uncached context.',
      'prompt "inspect-warning-fixture": token budget 3 is smaller than the stable prefix (48 tokens); uncached contexts were dropped entirely. Shrink cached contexts or raise the budget.',
    ]);
  });
});
