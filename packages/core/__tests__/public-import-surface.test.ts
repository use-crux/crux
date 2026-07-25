/**
 * Characterization tests for the **published import surface** of `@use-crux/core`.
 *
 * Every other suite in this package imports through *relative* paths
 * (`../define`, `../context`, `../safety/...`). Those imports follow the files
 * as they move, so they cannot prove that the package's public contract — the
 * `@use-crux/core` barrel and its `package.json` subpaths — keeps resolving and
 * keeps exporting the documented values.
 *
 * This suite imports **only** through the package specifier and its subpaths.
 * It is deliberately immune to internal file layout: when the Core structure
 * refactor moves implementation between domain folders, these tests must stay
 * green without edits. They are the guardrail that makes those moves provably
 * behavior-preserving.
 *
 * What this suite pins:
 * - the subpath resolves at runtime (self-referenced package + `exports` map);
 * - each documented value export is present and callable;
 * - a representative behavior of each entry point still works end to end.
 *
 * What this suite intentionally does **not** pin:
 * - private file locations or internal collaborator wiring (see the relative
 *   suites for that);
 * - type-level inference, which is covered by `__type_tests__/` under `tsc`.
 *
 * @see {@link file://./public-root-imports.ts} — the type-level companion.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";

// The subject under test is always the *package specifier*, never a relative
// path — that is the whole point of a public-surface characterization suite.
import {
  prompt,
  context,
  createPrompts,
  createContexts,
  when,
  match,
  config,
  md,
} from "@use-crux/core";
import { tool } from "@use-crux/core/tools";
import {
  toolMiddleware,
  approvalMiddleware,
} from "@use-crux/core/tool-middleware";
import {
  adapter,
  loopRuntimeAdapter,
  defineProviderRuntime,
  defineSingleTurnProviderBundle,
} from "@use-crux/core/adapter";
import {
  boundary,
  guardrail,
  constraint,
  isGuardrail,
  isConstraint,
  createSafety,
  createSafetyPlugin,
} from "@use-crux/core/safety";

// ─────────────────────────────────────────────────────────────────
// @use-crux/core — prompt + context authoring root barrel
// ─────────────────────────────────────────────────────────────────

describe("@use-crux/core (root barrel)", () => {
  it("exposes the documented authoring entry points", () => {
    expect(typeof prompt).toBe("function");
    expect(typeof context).toBe("function");
    expect(typeof createPrompts).toBe("function");
    expect(typeof createContexts).toBe("function");
    expect(typeof when).toBe("function");
    expect(typeof match).toBe("function");
    expect(typeof config).toBe("function");
    expect(typeof md).toBe("function");
  });

  it("md() authors structured system and prompt text through the public surface", async () => {
    const authored = prompt({
      id: "structured-public",
      system: md`System ${"value"}`,
      prompt: md`Prompt ${"value"}`,
    });

    const resolved = await authored.resolve({});

    expect(resolved.system).toBe("System value");
    expect(resolved.prompt).toBe("Prompt value");
  });

  it("prompt() composes context system text through the public surface", async () => {
    const brand = context({
      id: "brand",
      input: z.object({ brand: z.string() }),
      system: ({ input }) => `Brand: ${input.brand}`,
    });

    const answer = prompt({
      id: "answer",
      use: [brand],
      input: z.object({ question: z.string() }),
      system: "You are helpful.",
      prompt: ({ input }) => input.question,
    });

    const resolved = await answer.resolve({
      input: { question: "Hi?", brand: "Acme" },
    });

    expect(resolved.system).toBe("You are helpful.\n\nBrand: Acme");
    expect(resolved.prompt).toBe("Hi?");
  });

  it("when()/match() gate context contributions through the public surface", async () => {
    const onlyEn = when(
      (input: { locale: string }) => input.locale === "en",
      context({ id: "en", system: "Answer in English." }),
    );
    const branched = match({
      on: (input: { mode: string }) => input.mode,
      cases: { terse: context({ id: "terse", system: "Be terse." }) },
      default: context({ id: "verbose", system: "Be verbose." }),
    });

    const p = prompt({
      id: "gated",
      use: [onlyEn, branched],
      system: "Base.",
      prompt: () => "go",
    });

    const en = await p.resolve({ input: { locale: "en", mode: "terse" } });
    expect(en.system).toBe("Base.\n\nAnswer in English.\n\nBe terse.");

    const fr = await p.resolve({ input: { locale: "fr", mode: "other" } });
    expect(fr.system).toBe("Base.\n\nBe verbose.");
  });

  it("createPrompts()/createContexts() build addressable trees", () => {
    const ctxTree = createContexts({
      tone: context({ id: "tone", system: "Friendly." }),
    });
    expect(ctxTree.tone.id).toBe("tone");

    const promptTree = createPrompts({
      greet: prompt({ id: "greet", system: "Hi.", prompt: () => "hi" }),
    });
    expect(promptTree.greet.id).toBe("greet");
  });
});

// ─────────────────────────────────────────────────────────────────
// @use-crux/core/tools — SDK-agnostic tool authoring
// ─────────────────────────────────────────────────────────────────

describe("@use-crux/core/tools", () => {
  it("tool() builds a frozen tool definition with a runnable execute()", async () => {
    expect(typeof tool).toBe("function");

    const search = tool({
      description: "Search the docs",
      input: z.object({ query: z.string() }),
      execute: ({ query }) => `results for ${query}`,
    });

    expect(search.description).toBe("Search the docs");
    expect(typeof search.execute).toBe("function");
    expect(Object.isFrozen(search)).toBe(true);
    expect(await search.execute({ query: "crux" })).toBe("results for crux");
  });
});

// ─────────────────────────────────────────────────────────────────
// @use-crux/core/tool-middleware — tool middleware authoring
// ─────────────────────────────────────────────────────────────────

describe("@use-crux/core/tool-middleware", () => {
  it("toolMiddleware() builds a tagged middleware object", () => {
    expect(typeof toolMiddleware).toBe("function");

    const mw = toolMiddleware({ id: "logger" });
    expect(mw._tag).toBe("ToolMiddleware");
    expect(mw.id).toBe("logger");
  });

  it("approvalMiddleware() builds a tagged middleware object", () => {
    expect(typeof approvalMiddleware).toBe("function");

    const mw = approvalMiddleware({ id: "gate", match: ["dangerous_tool"] });
    expect(mw._tag).toBe("ToolMiddleware");
    expect(mw.id).toBe("gate");
  });
});

// ─────────────────────────────────────────────────────────────────
// @use-crux/core/adapter — provider adapter authoring
// ─────────────────────────────────────────────────────────────────

describe("@use-crux/core/adapter", () => {
  it("exposes the documented adapter/provider-runtime factories", () => {
    expect(typeof adapter).toBe("function");
    expect(typeof loopRuntimeAdapter).toBe("function");
    expect(typeof defineProviderRuntime).toBe("function");
    expect(typeof defineSingleTurnProviderBundle).toBe("function");
  });

  it("adapter() returns a client-bound factory exposing generate/stream", () => {
    const createTestAdapter = adapter<{ token: string }>({
      providerId: "test-provider",
      call: async () => ({ text: "", toolCalls: [] }),
      stream: async () => ({
        stream: (async function* () {})(),
        result: async () => ({ text: "", toolCalls: [] }),
      }),
      appendToolRound: (messages) => messages,
      mapSettings: () => ({}),
    });

    expect(typeof createTestAdapter).toBe("function");

    const bound = createTestAdapter({ token: "x" });
    expect(bound.providerId).toBe("test-provider");
    expect(typeof bound.generate).toBe("function");
    expect(typeof bound.stream).toBe("function");
  });
});

// ─────────────────────────────────────────────────────────────────
// @use-crux/core/safety — guardrail + constraint authoring and sessions
// ─────────────────────────────────────────────────────────────────

describe("@use-crux/core/safety", () => {
  it("guardrail() builds a recognizable guardrail", () => {
    const guard = guardrail({
      id: "no-secrets",
      on: boundary.output.text(),
      run: async (content: string) =>
        content.includes("secret")
          ? { action: "block" as const, reason: "leak" }
          : { action: "allow" as const },
    });

    expect(guard._tag).toBe("Guardrail");
    expect(isGuardrail(guard)).toBe(true);
  });

  it("constraint() builds a recognizable constraint", () => {
    const c = constraint({
      id: "non-empty",
      on: boundary.output.both(),
      run: async () => ({ pass: true }),
    });

    expect(c._tag).toBe("Constraint");
    expect(isConstraint(c)).toBe(true);
  });

  it("createSafety() opens a per-call session with the documented methods", () => {
    expect(typeof createSafety).toBe("function");

    const session = createSafety({});
    expect(typeof session.guardInput).toBe("function");
    expect(typeof session.finalizeOutput).toBe("function");
    expect(typeof session.stamp).toBe("function");
  });

  it("createSafetyPlugin() builds the named safety plugin", () => {
    const plugin = createSafetyPlugin({});
    expect(plugin.name).toBe("crux:safety");
    expect(typeof plugin.install).toBe("function");
  });
});
