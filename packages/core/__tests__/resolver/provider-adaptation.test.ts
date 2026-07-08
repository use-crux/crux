import { describe, expect, it } from "vitest";
import { compilePrompt } from "../../resolver/compile";
import { context } from "../../prompt/context";
import type { AnyPromptConfig } from "../../prompt/prompt-types";
import { imagePart, textPart } from "../../content";

describe("resolver provider adaptation contract", () => {
  it("messages mode never re-emits system after adaptation", async () => {
    const config = {
      messages: () => [{ role: "user" as const, content: "Draft the reply." }],
      adapt: {
        openai: { prependSystem: "Use OpenAI-compatible formatting." },
      },
    } satisfies AnyPromptConfig;

    const result = await compilePrompt(config).resolve({ provider: "openai" });

    expect(result.args.system).toBeUndefined();
    expect(result.args.systemBlocks).toBeUndefined();
    expect(result.args.messages).toEqual([
      { role: "system", content: "Use OpenAI-compatible formatting." },
      { role: "user", content: "Draft the reply." },
    ]);
  });

  it("systemBlocks join equals system after adaptation", async () => {
    const config = {
      system: "Base system.",
      prompt: "Question.",
      adapt: {
        openai: { appendSystem: "Provider tail." },
      },
    } satisfies AnyPromptConfig;

    const result = await compilePrompt(config).resolve({ provider: "openai" });
    const blockText = result.args.systemBlocks
      ?.map((block) => block.text)
      .join("\n\n");

    expect(result.args.system).toBe("Base system.\n\nProvider tail.");
    expect(blockText).toBe(result.args.system);
    expect(result.args.systemBlocks?.at(-1)).toMatchObject({
      source: "adaptation:openai",
      text: "Provider tail.",
      providerCache: false,
    });
  });

  it("adaptation text appears in folded messages system", async () => {
    const config = {
      messages: () => [
        { role: "system" as const, content: "Existing message system." },
        { role: "user" as const, content: "Draft the reply." },
      ],
      adapt: {
        openai: {
          prependSystem: "Provider head.",
          appendSystem: "Provider tail.",
        },
      },
    } satisfies AnyPromptConfig;

    const result = await compilePrompt(config).resolve({ provider: "openai" });

    expect(result.args.system).toBeUndefined();
    expect(result.args.messages?.[0]).toEqual({
      role: "system",
      content: "Provider head.\n\nProvider tail.\n\nExisting message system.",
    });
  });

  it("projects multimodal system messages before provider adaptation folding", async () => {
    const config = {
      messages: () => [
        {
          role: "system" as const,
          content: [
            textPart("Existing message system."),
            imagePart({ data: new Uint8Array([1, 2, 3]), mediaType: "image/png" }),
          ],
        },
        { role: "user" as const, content: "Draft the reply." },
      ],
      adapt: {
        openai: { prependSystem: "Provider head." },
      },
    } satisfies AnyPromptConfig;

    const result = await compilePrompt(config).resolve({ provider: "openai" });

    expect(result.args.messages?.[0]?.content).toContain("Provider head.\n\nExisting message system.");
    expect(result.args.messages?.[0]?.content).toContain("[image image/png 3B sha256:");
    expect(result.args.messages?.[0]?.content).not.toContain("[object Object]");
    expect(result.args.messages?.[0]?.content).not.toContain("AQID");
  });

  const adaptationCases = [
    { mode: "prompt", adapt: {}, expectedSystem: "Base system." },
    {
      mode: "prompt",
      adapt: { prependSystem: "Provider head." },
      expectedSystem: "Base system.\n\nProvider head.",
    },
    {
      mode: "prompt",
      adapt: { appendSystem: "Provider tail." },
      expectedSystem: "Base system.\n\nProvider tail.",
    },
    {
      mode: "prompt",
      adapt: {
        prependSystem: "Provider head.",
        appendSystem: "Provider tail.",
      },
      expectedSystem: "Base system.\n\nProvider head.\n\nProvider tail.",
    },
    { mode: "messages", adapt: {}, expectedSystem: "Base system." },
    {
      mode: "messages",
      adapt: { prependSystem: "Provider head." },
      expectedSystem: "Provider head.\n\nBase system.",
    },
    {
      mode: "messages",
      adapt: { appendSystem: "Provider tail." },
      expectedSystem: "Base system.\n\nProvider tail.",
    },
    {
      mode: "messages",
      adapt: {
        prependSystem: "Provider head.",
        appendSystem: "Provider tail.",
      },
      expectedSystem: "Provider head.\n\nBase system.\n\nProvider tail.",
    },
  ] as const;

  it.each(adaptationCases)(
    "systemBlocks join equals system for $mode with $adapt",
    async (testCase) => {
      const config =
        testCase.mode === "prompt"
          ? ({
              system: "Base system.",
              prompt: "Question.",
              adapt: { openai: testCase.adapt },
            } satisfies AnyPromptConfig)
          : ({
              messages: () => [
                { role: "system" as const, content: "Message system." },
                { role: "user" as const, content: "Question." },
              ],
              use: [
                context({
                  id: `base-context-${testCase.mode}-${Object.keys(testCase.adapt).join("-") || "none"}`,
                  system: "Base system.",
                }),
              ],
              adapt: { openai: testCase.adapt },
            } satisfies AnyPromptConfig);

      const result = await compilePrompt(config).resolve({
        provider: "openai",
      });
      if (testCase.mode === "prompt") {
        const blockText = result.args.systemBlocks
          ?.map((block) => block.text)
          .join("\n\n");
        expect(blockText).toBe(testCase.expectedSystem);
        expect(result.args.system).toBe(testCase.expectedSystem);
      } else {
        expect(result.args.system).toBeUndefined();
        expect(result.args.systemBlocks).toBeUndefined();
        expect(result.args.messages?.[0]?.content).toBe(
          `${testCase.expectedSystem}\n\nMessage system.`,
        );
      }
    },
  );

  it("append on empty system produces no leading separator", async () => {
    const config = {
      prompt: "Question.",
      adapt: {
        openai: { appendSystem: "Provider tail." },
      },
    } satisfies AnyPromptConfig;

    const result = await compilePrompt(config).resolve({ provider: "openai" });

    expect(result.args.system).toBe("Provider tail.");
    expect(result.args.systemBlocks).toEqual([
      {
        source: "adaptation:openai",
        text: "Provider tail.",
        providerCache: false,
      },
    ]);
  });

  it("inspect projection reflects provider adaptation system text", async () => {
    const config = {
      system: "Base system.",
      prompt: "Question.",
      adapt: {
        openai: { appendSystem: "Provider tail." },
      },
    } satisfies AnyPromptConfig;

    const result = await compilePrompt(config).resolve({ provider: "openai" });

    expect(result.inspect().system.total).toBe(
      "Base system.\n\nProvider tail.",
    );
  });
});
