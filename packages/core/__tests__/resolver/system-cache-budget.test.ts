import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  compilePrompt,
  context,
  createResolverFakes,
  staticTokenizer,
  type AnyPromptConfig,
  type SystemBlock,
} from "../../src/index";

function charTokenizer() {
  return staticTokenizer((text) => text.length);
}

function stablePrefixText(blocks: readonly SystemBlock[]) {
  const boundaryIndex = blocks.findIndex((block) => block.cacheBoundary);
  if (boundaryIndex === -1) return "";
  return blocks
    .slice(0, boundaryIndex + 1)
    .map((block) => block.text)
    .join("\n\n");
}

describe("system cache and budget composition", () => {
  it("cached blocks form stable prefix in author order", async () => {
    const uncachedEarly = context({ id: "tail-a", system: "tail early" });
    const cachedFirst = context({
      id: "cached-a",
      system: "cached first",
      cache: true,
    });
    const uncachedLate = context({ id: "tail-b", system: "tail late" });
    const cachedSecond = context({
      id: "cached-b",
      system: "cached second",
      cache: true,
    });

    const result = await compilePrompt({
      system: "identity",
      use: [uncachedEarly, cachedFirst, uncachedLate, cachedSecond],
    } satisfies AnyPromptConfig).resolve();

    expect(result.args.system).toBe(
      [
        "identity",
        "cached first",
        "cached second",
        "tail early",
        "tail late",
      ].join("\n\n"),
    );
    expect(
      result.args.systemBlocks?.map((block) => ({
        source: block.source,
        text: block.text,
        providerCache: block.providerCache,
        cacheBoundary: block.cacheBoundary,
      })),
    ).toEqual([
      {
        source: "prompt",
        text: "identity",
        providerCache: true,
        cacheBoundary: undefined,
      },
      {
        source: "context:cached-a",
        text: "cached first",
        providerCache: true,
        cacheBoundary: undefined,
      },
      {
        source: "context:cached-b",
        text: "cached second",
        providerCache: true,
        cacheBoundary: true,
      },
      {
        source: "context:tail-a",
        text: "tail early",
        providerCache: false,
        cacheBoundary: undefined,
      },
      {
        source: "context:tail-b",
        text: "tail late",
        providerCache: false,
        cacheBoundary: undefined,
      },
    ]);
  });

  it("keeps cache prefix and exact tail regardless of priority", async () => {
    const fakes = createResolverFakes({ tokenizer: charTokenizer() });
    const cachedLowestPriority = context({
      id: "cached",
      system: "CC",
      cache: true,
      priority: 1,
    });
    const tailLowPriority = context({
      id: "tail-low",
      system: "AA",
      priority: 10,
    });
    const tailHighPriority = context({
      id: "tail-high",
      system: "BB",
      priority: 90,
    });

    const compiled = compilePrompt(
      {
        system: "X",
        use: [cachedLowestPriority, tailLowPriority, tailHighPriority],
      } satisfies AnyPromptConfig,
      { ports: fakes.ports },
    );

    const resolved = await compiled.resolve();
    const inspected = await compiled.inspect();

    expect(resolved.args.system).toBe(["X", "CC", "AA", "BB"].join("\n\n"));
    expect(inspected.droppedContexts).toEqual([]);
  });

  it("keeps exact tail without a resolver overflow warning", async () => {
    const fakes = createResolverFakes({ tokenizer: charTokenizer() });
    const cached = context({
      id: "cached",
      system: "CCCC",
      cache: true,
    });
    const tail = context({
      id: "tail",
      system: "TT",
    });

    const resolved = await compilePrompt(
      {
        id: "overflowing",
        system: "X",
        use: [cached, tail],
      } satisfies AnyPromptConfig,
      { ports: fakes.ports },
    ).resolve();

    expect(resolved.args.system).toBe(["X", "CCCC", "TT"].join("\n\n"));
    expect(fakes.diagnostics.warnings).toEqual([]);
  });

  it("dynamic own system with cached contexts warns", async () => {
    const fakes = createResolverFakes();
    const cached = context({
      id: "cached",
      system: "Stable contribution.",
      cache: true,
    });

    await compilePrompt(
      {
        id: "dynamic-prefix",
        input: z.object({ name: z.string() }),
        system: ({ input }) => `Hello ${input.name}.`,
        use: [cached],
      } satisfies AnyPromptConfig,
      { ports: fakes.ports },
    ).resolve({ input: { name: "Ada" } });

    expect(fakes.diagnostics.warnings).toEqual([
      {
        message:
          'prompt "dynamic-prefix": contexts request provider caching but the prompt-level system is dynamic; content before a cache breakpoint must be byte-stable. Make `system` static or move dynamic parts into an uncached context.',
      },
    ]);
  });

  it("prefix byte-stable across tail input changes", async () => {
    const cached = context({
      id: "cached",
      input: z.object({ org: z.string() }),
      system: ({ input }) => `Prefix ${input.org}`,
      cache: true,
    });
    const tail = context({
      id: "tail",
      input: z.object({ request: z.string() }),
      system: ({ input }) => `Tail ${input.request}`,
    });
    const compiled = compilePrompt({
      system: "Identity",
      use: [tail, cached],
    } satisfies AnyPromptConfig);

    const first = await compiled.resolve({
      input: { org: "acme", request: "alpha" },
    });
    const second = await compiled.resolve({
      input: { org: "acme", request: "beta" },
    });

    expect(stablePrefixText(first.args.systemBlocks ?? [])).toBe(
      "Identity\n\nPrefix acme",
    );
    expect(stablePrefixText(second.args.systemBlocks ?? [])).toBe(
      "Identity\n\nPrefix acme",
    );
    expect(first.args.system).toBe("Identity\n\nPrefix acme\n\nTail alpha");
    expect(second.args.system).toBe("Identity\n\nPrefix acme\n\nTail beta");
  });

  it("adaptation prepend lands after the stable cached prefix", async () => {
    const cached = context({
      id: "cached",
      input: z.object({ org: z.string() }),
      system: ({ input }) => `Prefix ${input.org}`,
      cache: true,
    });
    const tail = context({
      id: "tail",
      input: z.object({ request: z.string() }),
      system: ({ input }) => `Tail ${input.request}`,
    });
    const compiled = compilePrompt({
      system: "Identity",
      use: [tail, cached],
      adapt: {
        openai: {
          prependSystem: "OpenAI adaptation",
        },
      },
    } satisfies AnyPromptConfig);

    const first = await compiled.resolve({
      provider: "openai",
      input: { org: "acme", request: "alpha" },
    });
    const second = await compiled.resolve({
      provider: "openai",
      input: { org: "acme", request: "beta" },
    });

    expect(first.args.systemBlocks?.map((block) => block.source)).toEqual([
      "prompt",
      "context:cached",
      "adaptation:openai",
      "context:tail",
    ]);
    expect(stablePrefixText(first.args.systemBlocks ?? [])).toBe(
      "Identity\n\nPrefix acme",
    );
    expect(stablePrefixText(second.args.systemBlocks ?? [])).toBe(
      "Identity\n\nPrefix acme",
    );
    expect(first.args.system).toBe(
      "Identity\n\nPrefix acme\n\nOpenAI adaptation\n\nTail alpha",
    );
    expect(second.args.system).toBe(
      "Identity\n\nPrefix acme\n\nOpenAI adaptation\n\nTail beta",
    );
  });

  it("prompt-level provider cache marks the own-system block as the boundary", async () => {
    const result = await compilePrompt({
      system: "Only stable prompt text.",
      cache: { provider: true },
    } satisfies AnyPromptConfig).resolve();

    expect(
      result.args.systemBlocks?.map((block) => ({
        source: block.source,
        providerCache: block.providerCache,
        cacheBoundary: block.cacheBoundary,
      })),
    ).toEqual([
      {
        source: "prompt",
        providerCache: true,
        cacheBoundary: true,
      },
    ]);
  });
});
