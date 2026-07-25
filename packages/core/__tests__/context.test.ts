import { describe, it, expect } from "vitest";
import { z } from "zod";
import { context, createContexts } from "../src/prompt/context";
import { md } from "../src/prompt-text";

describe("context()", () => {
  it("static context: systemFn returns the string", () => {
    const ctx = context({ system: "Be polite." });
    expect(ctx.systemFn({})).toBe("Be polite.");
  });

  it("direct PromptText is wrapped unchanged and classified as static", () => {
    const fragment = md`Be ${"precise"}.`;
    const ctx = context({ system: fragment });

    expect(ctx.systemFn({})).toBe(fragment);
    expect(ctx.systemKind).toBe("static");
  });

  it("dynamic context: systemFn calls the function with input", () => {
    const ctx = context({
      input: z.object({ lang: z.string() }),
      system: ({ input }) => `Respond in ${input.lang}.`,
    });
    expect(ctx.systemFn({ lang: "French" })).toBe("Respond in French.");
  });

  it("priority defaults to 50", () => {
    const ctx = context({ system: "text" });
    expect(ctx.priority).toBe(50);
  });

  it("custom priority is preserved", () => {
    const ctx = context({ system: "text", priority: 10 });
    expect(ctx.priority).toBe(10);
  });

  it("inputSchema and inputKeys extracted correctly", () => {
    const ctx = context({
      input: z.object({ foo: z.string(), bar: z.number() }),
      system: "text",
    });
    expect(ctx.inputSchema).toBeDefined();
    expect([...ctx.inputKeys]).toEqual(["foo", "bar"]);
  });

  it("static tools returned via toolsFn", () => {
    const tools = { search: "tool" };
    const ctx = context({ system: "text", tools });
    expect(ctx.toolsFn).toBeDefined();
    expect(ctx.toolsFn!({})).toEqual({ search: "tool" });
  });

  it("dynamic tools function called with input", () => {
    const ctx = context({
      input: z.object({ enabled: z.boolean() }),
      system: "text",
      tools: ({ input }: any) => (input.enabled ? { search: "tool" } : {}),
    });
    expect(ctx.toolsFn!({ enabled: true })).toEqual({ search: "tool" });
    expect(ctx.toolsFn!({ enabled: false })).toEqual({});
  });

  it("context without tools has toolsFn = undefined", () => {
    const ctx = context({ system: "text" });
    expect(ctx.toolsFn).toBeUndefined();
  });

  it("context is frozen", () => {
    const ctx = context({ id: "test", system: "text" });
    expect(Object.isFrozen(ctx)).toBe(true);
  });

  it("has _tag = Context", () => {
    const ctx = context({ system: "text" });
    expect(ctx._tag).toBe("Context");
  });

  it("id and description are preserved", () => {
    const ctx = context({
      id: "my-ctx",
      description: "My context",
      system: "text",
    });
    expect(ctx.id).toBe("my-ctx");
    expect(ctx.description).toBe("My context");
  });

  it("inputKeys is frozen", () => {
    const ctx = context({
      input: z.object({ a: z.string() }),
      system: "text",
    });
    expect(Object.isFrozen(ctx.inputKeys)).toBe(true);
  });

  it("async system function returns a promise", async () => {
    const ctx = context({
      id: "async-ctx",
      system: async () => {
        await new Promise((r) => setTimeout(r, 1));
        return "Async result";
      },
    });

    const result = await ctx.systemFn({});
    expect(result).toBe("Async result");
  });

  it("async system function with input", async () => {
    const ctx = context({
      id: "async-input",
      input: z.object({ userId: z.string() }),
      system: async ({ input }) => {
        await new Promise((r) => setTimeout(r, 1));
        return `User: ${input.userId}`;
      },
    });

    const result = await ctx.systemFn({ userId: "user_123" });
    expect(result).toBe("User: user_123");
  });
  // ── Cache and memo option parsing ──

  describe("cache and memo options", () => {
    it("cache: true sets only providerCache", () => {
      const ctx = context({ id: "c1", system: () => "dynamic", cache: true });
      expect(ctx.memoTtl).toBe(0);
      expect(ctx.providerCache).toBe(true);
    });

    it("memo sets only memoTtl", () => {
      const ctx = context({
        id: "c1",
        system: () => "dynamic",
        memo: { ttl: 60_000 },
      });
      expect(ctx.memoTtl).toBe(60_000);
      expect(ctx.providerCache).toBe(false);
    });

    it("cache and memo can be combined explicitly", () => {
      const ctx = context({
        id: "c1",
        system: () => "dynamic",
        cache: true,
        memo: { ttl: 300_000 },
      });
      expect(ctx.memoTtl).toBe(300_000);
      expect(ctx.providerCache).toBe(true);
    });

    it("no cache or memo option defaults to memoTtl: 0 and providerCache: false", () => {
      const ctx = context({ id: "c1", system: "text" });
      expect(ctx.memoTtl).toBe(0);
      expect(ctx.providerCache).toBe(false);
    });

    it("cache: false defaults to memoTtl: 0 and providerCache: false", () => {
      const ctx = context({ id: "c1", system: "text", cache: false });
      expect(ctx.memoTtl).toBe(0);
      expect(ctx.providerCache).toBe(false);
    });

    it("throws if memo is set but no id", () => {
      expect(() =>
        context({ system: () => "dynamic", memo: { ttl: 300_000 } }),
      ).toThrow(/memo requires an id/);
    });

    it("static string system with memo throws", () => {
      expect(() =>
        context({
          id: "c1",
          system: "A static string",
          memo: { ttl: 300_000 },
        }),
      ).toThrow(/memo has no effect on a static context/);
    });

    it("direct PromptText system with memo throws", () => {
      expect(() =>
        context({
          id: "c1",
          system: md`A static ${"fragment"}.`,
          memo: { ttl: 300_000 },
        }),
      ).toThrow(/memo has no effect on a static context/);
    });
  });
});

describe("createContexts()", () => {
  it("deep-freezes a nested tree", () => {
    const tree = createContexts({
      editor: {
        proseMirror: context({ system: "PM context" }),
        instructions: context({ system: "Instructions" }),
      },
      brand: context({ system: "Brand" }),
    });

    expect(Object.isFrozen(tree)).toBe(true);
    expect(Object.isFrozen(tree.editor)).toBe(true);
    expect(tree.editor.proseMirror._tag).toBe("Context");
    expect(tree.brand._tag).toBe("Context");
  });

  it("throws on non-Context leaf values", () => {
    expect(() =>
      createContexts({
        bad: "not a context" as any,
      }),
    ).toThrow(/invalid value at "bad"/);
  });

  it("throws on array values", () => {
    expect(() =>
      createContexts({
        bad: [] as any,
      }),
    ).toThrow(/invalid value/);
  });

  it("allows deeply nested trees", () => {
    const tree = createContexts({
      a: {
        b: {
          c: context({ system: "deep" }),
        },
      },
    });
    expect(tree.a.b.c.systemFn({})).toBe("deep");
  });
});
