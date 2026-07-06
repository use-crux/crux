import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  context,
  contributor,
  createContexts,
  createPrompts,
  match,
  prompt,
} from "../../prompt";
import { compilePrompt } from "../../resolver/compile";
import { createResolverFakes } from "../../resolver/fakes";

describe("resolver memoization integrity", () => {
  it("duplicate context ids throw at prompt definition", () => {
    const first = context({ id: "dup-cache", system: "First." });
    const second = context({ id: "dup-cache", system: "Second." });

    expect(() =>
      prompt({
        id: "dup-prompt",
        use: [first, second],
        system: "Resolve duplicate ids.",
      }),
    ).toThrow(
      'prompt(dup-prompt): duplicate entry id "dup-cache" — entry ids must be unique within a prompt.',
    );
  });

  it("systemFn receives only declared input keys", async () => {
    const localized = context({
      id: "localized",
      input: z.object({ locale: z.string() }),
      system: ({ input }) =>
        `keys=${Object.keys(input).sort().join(",")}; user=${String("user" in input)}`,
    });
    const assistant = prompt({
      id: "declared-system-input",
      use: [localized],
      input: z.object({ user: z.string() }),
      system: "Use locale.",
    });

    const resolved = await assistant.resolve({
      input: { locale: "nl-NL", user: "Ada" },
    });

    expect(resolved.system).toContain("keys=locale; user=false");
  });

  it("context when receives only declared keys", async () => {
    const seenKeys: string[][] = [];
    const gated = context({
      id: "gated",
      input: z.object({ enabled: z.boolean() }),
      when: ({ input }) => {
        seenKeys.push(Object.keys(input).sort());
        return input.enabled;
      },
      system: "Enabled context.",
    });
    const assistant = prompt({
      id: "declared-when-input",
      use: [gated],
      input: z.object({ user: z.string() }),
      system: "Use gates.",
    });

    await assistant.resolve({ input: { enabled: true, user: "Ada" } });

    expect(seenKeys).toEqual([["enabled"]]);
  });

  it("context tools receive only declared input keys", async () => {
    const contextualTools = context({
      id: "tool-context",
      input: z.object({ enabled: z.boolean() }),
      system: "Tool context.",
      tools: ({ input }) => ({
        check: {
          description: Object.keys(input).sort().join(","),
          parameters: z.object({}),
          execute: () => "ok",
        },
      }),
    });
    const assistant = prompt({
      id: "declared-tool-input",
      use: [contextualTools],
      input: z.object({ user: z.string() }),
      system: "Use tools.",
    });

    const resolved = await assistant.resolve({
      input: { enabled: true, user: "Ada" },
    });

    expect(resolved.tools?.check).toMatchObject({ description: "enabled" });
  });

  it("memo key ignores undeclared prompt fields (poisoning repro)", async () => {
    const fakes = createResolverFakes();
    let runs = 0;
    const tenantPolicy = context({
      id: "tenant-policy",
      input: z.object({ tenant: z.string() }),
      memo: { ttl: 300_000 },
      system: ({ input }) => `tenant=${input.tenant}; run=${++runs}`,
    });
    const compiled = compilePrompt(
      {
        id: "memo-poisoning",
        use: [tenantPolicy],
        input: z.object({ user: z.string() }),
        system: "Use tenant policy.",
      },
      { ports: fakes.ports },
    );

    const first = await compiled.resolve({
      input: { tenant: "acme", user: "alice" },
    });
    const second = await compiled.resolve({
      input: { tenant: "acme", user: "bob" },
    });

    expect(first.args.system).toContain("tenant=acme; run=1");
    expect(second.args.system).toContain("tenant=acme; run=1");
    expect(fakes.instrumentation.events.map((event) => event.kind)).toEqual([
      "miss",
      "hit",
    ]);
    expect(fakes.instrumentation.events[0]).toMatchObject({
      cacheKey: 'cache:ctx:tenant-policy:{"tenant":"acme"}',
    });
  });

  it("memo on static context throws", () => {
    expect(() =>
      context({
        id: "static-memo",
        system: "Static content.",
        memo: { ttl: 300_000 },
      }),
    ).toThrow(
      "context(static-memo): memo has no effect on a static context — remove memo or make `system` a function.",
    );
  });

  it("memo without id throws", () => {
    expect(() =>
      context({ system: () => "Dynamic content.", memo: { ttl: 300_000 } }),
    ).toThrow(
      "context(): memo requires an id for cache key derivation. Add an `id` field to your context definition.",
    );
  });

  it("cache+short-memo emits contradiction diagnostic", async () => {
    const fakes = createResolverFakes();
    const volatile = context({
      id: "volatile-policy",
      cache: true,
      memo: { ttl: 60_000 },
      system: () => "Volatile cached content.",
    });

    const compiled = compilePrompt(
      { id: "diagnostic-prompt", use: [volatile], system: "Use context." },
      {
        ports: fakes.ports,
      },
    );

    expect(
      fakes.diagnostics.warnings.map((warning) => warning.message),
    ).toEqual([
      'context "volatile-policy": cache: true asks the provider to reuse this block for ~5 minutes, ' +
        "but memo.ttl (60000ms) declares it stale sooner. " +
        "Raise memo.ttl to ≥300000 or drop the provider cache hint.",
    ]);

    await compiled.resolve();

    expect(fakes.diagnostics.warnings).toHaveLength(1);
  });

  it("cache+short-memo warning is emitted once for reused branch contexts", () => {
    const fakes = createResolverFakes();
    const volatile = context({
      id: "reused-volatile-policy",
      cache: true,
      memo: { ttl: 60_000 },
      system: () => "Volatile cached content.",
    });

    compilePrompt(
      {
        id: "branch-warning-dedupe",
        use: [match({ on: () => "a", cases: { a: volatile, b: volatile } })],
        system: "Use context.",
      },
      { ports: fakes.ports },
    );

    expect(
      fakes.diagnostics.warnings.map((warning) => warning.message),
    ).toEqual([
      'context "reused-volatile-policy": cache: true asks the provider to reuse this block for ~5 minutes, ' +
        "but memo.ttl (60000ms) declares it stale sooner. " +
        "Raise memo.ttl to ≥300000 or drop the provider cache hint.",
    ]);
  });

  it("createContexts rejects duplicate leaf ids", () => {
    expect(() =>
      createContexts({
        alpha: context({ id: "shared", system: "A." }),
        nested: {
          beta: context({ id: "shared", system: "B." }),
        },
      }),
    ).toThrow(
      'createContexts: duplicate context id "shared" at "alpha" and "nested.beta".',
    );
  });

  it("createPrompts rejects duplicate leaf ids", () => {
    expect(() =>
      createPrompts({
        alpha: prompt({ id: "shared-prompt", system: "A." }),
        nested: {
          beta: prompt({ id: "shared-prompt", system: "B." }),
        },
      }),
    ).toThrow(
      'createPrompts: duplicate prompt id "shared-prompt" at "alpha" and "nested.beta".',
    );
  });

  it("dynamically injected duplicate context ids throw at first resolve", async () => {
    const base = context({ id: "live-context", system: "Base." });
    const injector = contributor({
      id: "injector",
      contribute: () => ({
        contexts: [context({ id: "live-context", system: "Injected." })],
      }),
    });
    const assistant = prompt({
      id: "dynamic-duplicate",
      use: [base, injector],
      system: "Resolve dynamic ids.",
    });

    await expect(assistant.resolve({})).rejects.toThrow(
      'resolve(dynamic-duplicate): contributor "injector" injected context id "live-context" which already exists in this prompt.',
    );
  });

  it("dynamically injected duplicate context ids throw before later static entries", async () => {
    const injector = contributor({
      id: "injector",
      contribute: () => ({
        contexts: [context({ id: "later-context", system: "Injected." })],
      }),
    });
    const later = context({ id: "later-context", system: "Later static." });
    const assistant = prompt({
      id: "dynamic-before-static-duplicate",
      use: [injector, later],
      system: "Resolve dynamic ids.",
    });

    await expect(assistant.resolve({})).rejects.toThrow(
      'resolve(dynamic-before-static-duplicate): contributor "injector" injected context id "later-context" which already exists in this prompt.',
    );
  });
});
