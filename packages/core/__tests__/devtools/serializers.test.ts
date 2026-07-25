import { describe, it, expect } from "vitest";
import { z } from "zod";
import { prompt as makePrompt } from "../../src/prompt/prompt";
import { context } from "../../src/prompt/context";
import { md } from "../../src/prompt-text";
import { ProjectIndexSnapshotSchema } from "../../src/project-index";
import {
  serializePrompt,
  serializeContext,
  serializeIndex,
  serializeProjectIndex,
} from "../../src/project-index/serializers";

// ─────────────────────────────────────────────────────────────────
// serializePrompt()
// ─────────────────────────────────────────────────────────────────

describe("serializePrompt", () => {
  it("serializes a prompt with input and output schemas", () => {
    const prompt = makePrompt({
      id: "greeting",
      description: "Greet the user",
      tags: ["test"],
      input: z.object({ name: z.string() }),
      output: z.object({ message: z.string() }),
      system: "You greet people.",
    });

    const meta = serializePrompt(prompt);

    expect(meta.id).toBe("greeting");
    expect(meta.description).toBe("Greet the user");
    expect(meta.tags).toEqual(["test"]);
    expect(meta.hasOutput).toBe(true);
    expect(meta.inputSchema).toBeDefined();
    expect(meta.outputSchema).toBeDefined();
    expect(meta.contextIds).toEqual([]);
    expect(meta.systemTemplate).toBe("You greet people.");
  });

  it("serializes a prompt without schemas", () => {
    const prompt = makePrompt({
      id: "bare",
      system: "A simple prompt.",
    });

    const meta = serializePrompt(prompt);

    expect(meta.id).toBe("bare");
    expect(meta.hasOutput).toBe(false);
    expect(meta.outputSchema).toBeUndefined();
    expect(meta.tags).toEqual([]);
    expect(meta.systemTemplate).toBe("A simple prompt.");
  });

  it("includes context IDs from composed contexts", () => {
    const ctx = context({ id: "tone", system: "Be formal." });
    const prompt = makePrompt({
      id: "with-ctx",
      system: "You are helpful.",
      use: [ctx],
    });

    const meta = serializePrompt(prompt);

    expect(meta.contextIds).toEqual(["tone"]);
  });

  it("extracts prompt template from function", () => {
    const prompt = makePrompt({
      id: "fn-prompt",
      system: "You are a bot.",
      prompt: ({ input }) => `Hello ${input.name}`,
      input: z.object({ name: z.string() }),
    });

    const meta = serializePrompt(prompt);

    expect(meta.promptTemplate).toBeDefined();
    expect(typeof meta.promptTemplate).toBe("string");
  });

  it("includes settings from prompt config", () => {
    const prompt = makePrompt({
      id: "with-settings",
      system: "Test.",
      settings: { temperature: 0.5, maxTokens: 100 },
    });

    const meta = serializePrompt(prompt);

    expect(meta.settings).toEqual({ temperature: 0.5, maxTokens: 100 });
  });

  it("lowers direct PromptText templates without leaking private shells", () => {
    const prompt = makePrompt({
      id: "structured",
      system: md`System ${"value"}`,
      prompt: md`Prompt ${"value"}`,
    });

    const meta = serializePrompt(prompt);
    const json = JSON.stringify(meta);

    expect(meta.systemTemplate).toBe("System value");
    expect(meta.promptTemplate).toBe("Prompt value");
    expect(json).not.toContain("[object Object]");
    expect(json).not.toContain('"systemTemplate":{}');
    expect(json).not.toContain('"promptTemplate":{}');
  });
});

// ─────────────────────────────────────────────────────────────────
// serializeContext()
// ─────────────────────────────────────────────────────────────────

describe("serializeContext", () => {
  it("serializes a static context", () => {
    const ctx = context({
      id: "brand-voice",
      description: "Brand voice guidelines",
      system: "Always use a professional tone.",
    });

    const meta = serializeContext(ctx, []);

    expect(meta.id).toBe("brand-voice");
    expect(meta.description).toBe("Brand voice guidelines");
    expect(meta.isStatic).toBe(true);
    expect(meta.usedBy).toEqual([]);
    expect(meta.systemTemplate).toBe("Always use a professional tone.");
  });

  it("computes usedBy from prompt associations", () => {
    const ctx = context({ id: "tone", system: "Be formal." });
    const promptA = makePrompt({ id: "a", system: "A", use: [ctx] });
    const promptB = makePrompt({ id: "b", system: "B", use: [ctx] });
    const promptC = makePrompt({ id: "c", system: "C" });

    const meta = serializeContext(ctx, [promptA, promptB, promptC]);

    expect(meta.usedBy).toEqual(["a", "b"]);
  });

  it("serializes a context with input schema as non-static", () => {
    const ctx = context({
      id: "dynamic",
      input: z.object({ topic: z.string() }),
      system: ({ input }) => `Talk about ${input.topic}`,
    });

    const meta = serializeContext(ctx, []);

    expect(meta.isStatic).toBe(false);
    expect(meta.inputSchema).toBeDefined();
  });

  it("uses default priority of 50", () => {
    const ctx = context({ id: "default-pri", system: "Test." });

    const meta = serializeContext(ctx, []);

    expect(meta.priority).toBe(50);
  });

  it("uses custom priority", () => {
    const ctx = context({ id: "high-pri", system: "Important.", priority: 90 });

    const meta = serializeContext(ctx, []);

    expect(meta.priority).toBe(90);
  });

  it("lowers a direct PromptText context as static metadata", () => {
    const ctx = context({
      id: "structured-context",
      system: md`Context ${"value"}`,
    });

    const meta = serializeContext(ctx, []);

    expect(meta.isStatic).toBe(true);
    expect(meta.systemTemplate).toBe("Context value");
    expect(JSON.stringify(meta)).not.toContain("[object Object]");
  });

  it("does not execute an inputless dynamic context callback", () => {
    let calls = 0;
    const ctx = context({
      id: "inputless-dynamic",
      system: () => {
        calls += 1;
        return md`
Dynamic
        `;
      },
    });

    const meta = serializeContext(ctx, []);

    expect(calls).toBe(0);
    expect(meta.isStatic).toBe(false);
    expect(typeof meta.systemTemplate).toBe("string");
    expect(meta.systemTemplate).not.toContain("[object Object]");
  });
});

// ─────────────────────────────────────────────────────────────────
// serializeIndex()
// ─────────────────────────────────────────────────────────────────

describe("serializeIndex", () => {
  it("serializes a full index with prompts and contexts", () => {
    const ctx = context({ id: "tone", system: "Be formal." });
    const prompt = makePrompt({
      id: "greet",
      system: "You greet people.",
      use: [ctx],
    });

    const index = serializeIndex([prompt], [ctx]);

    expect(index.prompts).toHaveLength(1);
    expect(index.prompts[0].id).toBe("greet");
    expect(index.contexts).toHaveLength(1);
    expect(index.contexts[0].id).toBe("tone");
    expect(index.tools).toBeUndefined();
  });

  it("serializes an empty index", () => {
    const index = serializeIndex([], []);

    expect(index.prompts).toEqual([]);
    expect(index.contexts).toEqual([]);
    expect(index.tools).toBeUndefined();
  });

  it("deduplicates contexts from prompts and explicit list", () => {
    const ctx = context({ id: "shared", system: "Shared context." });
    const prompt = makePrompt({ id: "p1", system: "P1", use: [ctx] });

    // Pass ctx both via prompt.contexts AND as an explicit context
    const index = serializeIndex([prompt], [ctx]);

    expect(index.contexts).toHaveLength(1);
  });

  it("collects contexts from prompts not in explicit list", () => {
    const implicitCtx = context({ id: "implicit", system: "Implicit." });
    const prompt = makePrompt({ id: "p1", system: "P1", use: [implicitCtx] });

    // Do NOT pass implicitCtx in the explicit contexts array
    const index = serializeIndex([prompt], []);

    expect(index.contexts).toHaveLength(1);
    expect(index.contexts[0].id).toBe("implicit");
  });

  it("includes tools when provided", () => {
    const index = serializeIndex([], [], undefined, [
      {
        name: "search",
        description: "Search the web",
        parameters: z.object({ query: z.string() }),
      },
    ]);

    expect(index.tools).toHaveLength(1);
    expect(index.tools![0].name).toBe("search");
    expect(index.tools![0].description).toBe("Search the web");
  });

  it("applies namespace paths to prompts and contexts", () => {
    const ctx = context({ id: "tone", system: "Be formal." });
    const prompt = makePrompt({ id: "greet", system: "Hello.", use: [ctx] });
    const paths = new Map([
      ["greet", ["prompts", "greet"]],
      ["tone", ["contexts", "tone"]],
    ]);

    const index = serializeIndex([prompt], [ctx], paths);

    expect(index.prompts[0].path).toEqual(["prompts", "greet"]);
    expect(index.contexts[0].path).toEqual(["contexts", "tone"]);
  });
});

// ─────────────────────────────────────────────────────────────────
// serializeProjectIndex()
// ─────────────────────────────────────────────────────────────────

describe("serializeProjectIndex", () => {
  it("preserves index data while exposing definitions and relations", () => {
    const ctx = context({ id: "tone", system: "Be concise." });
    const prompt = makePrompt({
      id: "brief",
      description: "Write a short brief",
      tags: ["editorial"],
      input: z.object({ topic: z.string() }),
      system: "You write briefs.",
      use: [ctx],
    });

    const index = serializeProjectIndex({
      project: {
        root: "/repo",
        name: "demo",
        configFile: "/repo/crux.config.ts",
      },
      lint: {
        profile: "strict",
        rules: { "tool.missing_input_schema": { severity: "warning" } },
      },
      prompts: [prompt],
      contexts: [ctx],
      tools: [
        {
          name: "search",
          description: "Search the project",
          parameters: z.object({ query: z.string() }),
        },
      ],
      indexedAt: "2026-05-25T00:00:00.000Z",
    });

    expect(() => ProjectIndexSnapshotSchema.parse(index)).not.toThrow();
    expect(JSON.parse(JSON.stringify(index))).toEqual(index);
    expect(index.prompts).toHaveLength(1);
    expect(index.contexts).toHaveLength(1);
    expect(index.tools).toHaveLength(1);
    expect(index.project).toEqual({
      root: "/repo",
      name: "demo",
      configFile: "/repo/crux.config.ts",
    });
    expect(index.lint).toEqual({
      profile: "strict",
      rules: { "tool.missing_input_schema": { severity: "warning" } },
    });
    expect(index.ruleDescriptors).toEqual([]);
    expect(
      index.definitions.map((definition) => [definition.id, definition.kind]),
    ).toEqual([
      ["prompt:brief", "prompt"],
      ["context:tone", "context"],
      ["tool:search", "tool"],
    ]);
    expect(
      index.definitions.find((definition) => definition.id === "prompt:brief")
        ?.metadata,
    ).toEqual(
      expect.objectContaining({
        inputSchema: expect.objectContaining({ type: "object" }),
        outputSchema: undefined,
        hasOutput: false,
      }),
    );
    expect(
      index.definitions.find((definition) => definition.id === "context:tone")
        ?.metadata,
    ).toEqual(
      expect.objectContaining({
        inputSchema: undefined,
        isStatic: true,
      }),
    );
    expect(
      index.definitions.find((definition) => definition.id === "tool:search")
        ?.metadata,
    ).toEqual(
      expect.objectContaining({
        inputSchema: expect.objectContaining({ type: "object" }),
      }),
    );
    expect(index.relations).toContainEqual(
      expect.objectContaining({
        type: "prompt.uses_context",
        from: "prompt:brief",
        to: "context:tone",
        fidelity: "resolved",
      }),
    );
  });

  it("accepts and normalizes rule descriptor metadata", () => {
    const index = serializeProjectIndex({
      project: { root: "/repo" },
      prompts: [],
      indexedAt: "2026-05-25T00:00:00.000Z",
      ruleDescriptors: [
        {
          id: "prompt.missing_input_schema",
          source: "builtin",
          severity: "info",
          category: "contracts",
          maturity: "stable",
          confidence: "high",
          profiles: ["recommended", "strict"],
          title: "Prompt has no input schema",
          description: "Prompt inputs should be inspectable.",
          suppression: {
            supported: true,
            scope: "next-line",
            directive:
              "// crux-lint-disable-next-line prompt.missing_input_schema -- reason",
          },
        },
      ],
    });

    expect(ProjectIndexSnapshotSchema.parse(index).ruleDescriptors).toEqual(
      index.ruleDescriptors,
    );

    const legacy = { ...index };
    delete legacy.ruleDescriptors;
    expect(ProjectIndexSnapshotSchema.parse(legacy).ruleDescriptors).toEqual(
      [],
    );
  });

  it("accepts project shard metadata on source graph and source rows", () => {
    const index = serializeProjectIndex({
      project: { root: "/repo" },
      prompts: [],
      indexedAt: "2026-05-25T00:00:00.000Z",
      sourceGraph: {
        schemaVersion: 1,
        producedBy: "@use-crux/indexer",
        capabilities: [
          "source-dependencies",
          "source-dependents",
          "definition-ownership",
          "diagnostic-ownership",
          "project-shards",
        ],
        shards: [
          {
            id: ".",
            root: "/repo",
            name: "@fixture/root",
            packageFile: "/repo/package.json",
            configFile: "/repo/tsconfig.json",
            discoveredBy: "/repo/package.json",
            references: ["packages/app"],
          },
        ],
      },
      sources: [
        { file: "/repo/src/index.ts", status: "indexed", shardId: "." },
      ],
    });

    expect(ProjectIndexSnapshotSchema.parse(index).sourceGraph?.shards).toEqual(
      [
        expect.objectContaining({
          id: ".",
          root: "/repo",
          name: "@fixture/root",
          references: ["packages/app"],
        }),
      ],
    );
    expect(ProjectIndexSnapshotSchema.parse(index).sources[0]).toEqual(
      expect.objectContaining({ file: "/repo/src/index.ts", shardId: "." }),
    );
  });

  it("marks anonymous definitions as partial with diagnostics", () => {
    const prompt = makePrompt({
      system: "Anonymous prompt.",
    });

    const index = serializeProjectIndex({
      project: { root: "/repo" },
      prompts: [prompt],
      indexedAt: "2026-05-25T00:00:00.000Z",
    });

    expect(index.definitions[0]).toEqual(
      expect.objectContaining({
        id: "prompt:anonymous-1",
        kind: "prompt",
        fidelity: "partial",
      }),
    );
    expect(index.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "missing-definition-id",
        severity: "warning",
        relatedDefinitionIds: ["prompt:anonymous-1"],
      }),
    );
  });
});
