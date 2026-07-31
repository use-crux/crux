import { describe, expect, it } from "vitest";
import { md } from "../../src/prompt-text";
import { isPromptText } from "../../src/prompt-text/internal";
import {
  compilePrompt,
  context,
  createResolverFakes,
  fixedClock,
  inMemoryContextCache,
  staticTokenizer,
  type AnyPromptConfig,
} from "../../src/index";
import type { ResolverPorts } from "../../src/resolver/ports";

function config(value: unknown): AnyPromptConfig {
  return value as AnyPromptConfig;
}

describe("PromptText system resolution", () => {
  it("lowers prompt and context values before composing exact segments", async () => {
    const fakes = createResolverFakes({
      tokenizer: staticTokenizer((text) =>
        text.trim() ? text.trim().split(/\s+/).length : 0,
      ),
    });
    const direct = context({
      id: "direct",
      system: md`Direct ${"value"}`,
    });
    const dynamic = context({
      id: "dynamic",
      system: async () => md`Dynamic ${"value"}`,
    });
    const omitted = context({
      id: "omitted",
      system: () => md`${undefined}`,
    });

    const pass = await compilePrompt(
      config({
        system: md`Prompt ${"value"}`,
        use: [dynamic, omitted, direct],
      }),
      { ports: fakes.ports },
    ).resolve();

    expect(pass.args.system).toBe(
      ["Prompt value", "Dynamic value", "Direct value"].join("\n\n"),
    );
    expect(direct.systemKind).toBe("static");
    expect(dynamic.systemKind).toBe("dynamic");
    expect(pass.args.systemBlocks?.map((block) => block.source)).toEqual([
      "prompt",
      "context:dynamic",
      "context:direct",
    ]);
    const parts = pass.inspect().system.parts;
    expect(parts.find((part) => part.source === "prompt")).toMatchObject({
      source: "prompt",
      segments: [
        { text: "Prompt ", dynamic: false },
        { text: "value", dynamic: true },
      ],
      staticTokens: 1,
      dynamicTokens: 1,
    });
    expect(
      parts.find((part) => part.source === "context:dynamic"),
    ).toMatchObject({
      source: "context:dynamic",
      segments: [
        { text: "Dynamic ", dynamic: false },
        { text: "value", dynamic: true },
      ],
      staticTokens: 1,
      dynamicTokens: 1,
    });
    expect(
      parts.find((part) => part.source === "context:omitted"),
    ).toMatchObject({
      source: "context:omitted",
      text: "",
      skipped: true,
    });
    expect(
      parts.find((part) => part.source === "context:direct"),
    ).toMatchObject({
      source: "context:direct",
      segments: [
        { text: "Direct ", dynamic: false },
        { text: "value", dynamic: true },
      ],
      staticTokens: 1,
      dynamicTokens: 1,
    });
  });

  it("keeps exact context after lowering", async () => {
    const fakes = createResolverFakes({
      tokenizer: staticTokenizer((text) => text.length),
    });
    const keep = context({
      id: "keep",
      priority: 90,
      system: md`
BB
      `,
    });
    const drop = context({
      id: "drop",
      priority: 10,
      system: () => md`
AAAA
      `,
    });

    const pass = await compilePrompt(
      config({
        system: md`
X
        `,
        use: [drop, keep],
      }),
      { ports: fakes.ports },
    ).resolve();

    expect(pass.args.system).toBe("X\n\nAAAA\n\nBB");
    expect(pass.inspect().droppedContexts).toEqual([]);
  });

  it("treats direct prompt text as a stable provider-cache prefix", async () => {
    const fakes = createResolverFakes();
    const cached = context({
      id: "cached",
      system: md`Cached ${"context"}`,
      cache: true,
    });

    const pass = await compilePrompt(
      config({
        id: "static-prefix",
        system: md`Stable ${"snapshot"}`,
        use: [cached],
      }),
      { ports: fakes.ports },
    ).resolve();

    expect(fakes.diagnostics.warnings).toEqual([]);
    expect(pass.args.systemBlocks?.map((block) => block.providerCache)).toEqual(
      [true, true],
    );
  });

  it("treats an async callback result as lifecycle-dynamic", async () => {
    const fakes = createResolverFakes();
    const cached = context({
      id: "cached",
      system: "Cached context",
      cache: true,
    });

    await compilePrompt(
      config({
        id: "dynamic-prefix",
        system: async () => md`Dynamic ${"snapshot"}`,
        use: [cached],
      }),
      { ports: fakes.ports },
    ).resolve();

    expect(fakes.diagnostics.warnings).toEqual([
      {
        message:
          'prompt "dynamic-prefix": contexts request provider caching but the prompt-level system is dynamic; content before a cache breakpoint must be byte-stable. Make `system` static or move dynamic parts into an uncached context.',
      },
    ]);
  });

  it("memoizes lowered callback content and recounts a hit", async () => {
    const clock = fixedClock(1_000);
    const cache = inMemoryContextCache(clock);
    const base = createResolverFakes();
    let calls = 0;
    const memoized = context({
      id: "memoized",
      system: () => {
        calls += 1;
        return md`Static ${"dynamic"}`;
      },
      memo: { ttl: 60_000 },
    });
    const ports = (
      count: (text: string) => number,
    ): Partial<ResolverPorts> => ({
      ...base.ports,
      clock,
      cache,
      tokenizer: staticTokenizer(count),
    });

    await compilePrompt(config({ use: [memoized] }), {
      ports: ports(() => 1),
    }).resolve();
    const hit = await compilePrompt(config({ use: [memoized] }), {
      ports: ports((text) => text.length),
    }).resolve();

    expect(calls).toBe(1);
    expect(hit.inspect().system.parts[1]).toMatchObject({
      source: "context:memoized",
      servedFrom: "memo",
      staticTokens: 7,
      dynamicTokens: 7,
    });
    const stored = cache.entries.get("cache:ctx:memoized:")?.content;
    expect(stored).toMatchObject({
      text: "Static dynamic",
      segments: [
        { text: "Static ", dynamic: false },
        { text: "dynamic", dynamic: true },
      ],
    });
    expect(isPromptText(stored)).toBe(false);
  });

  it("lowers before system adaptations", async () => {
    const pass = await compilePrompt(
      config({
        system: md`
          Core ${"system"}
        `,
        adapt: {
          openai: {
            prependSystem: "Before",
            appendSystem: "After",
          },
        },
      }),
    ).resolve({ provider: "openai" });

    expect(pass.args.system).toBe("Core system\n\nBefore\n\nAfter");
    expect(pass.args.systemBlocks?.map((block) => block.text)).toEqual([
      "Core system",
      "Before",
      "After",
    ]);
  });
});
