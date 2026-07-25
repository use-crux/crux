import { describe, expect, it } from "vitest";
import { z } from "zod";
import { md } from "../../src/prompt-text";
import { isPromptText } from "../../src/prompt-text/internal";
import {
  compilePrompt,
  createResolverFakes,
  staticTokenizer,
  type AnyPromptConfig,
} from "../../src/index";

function config(value: unknown): AnyPromptConfig {
  return value as AnyPromptConfig;
}

function charTokenizerFakes() {
  return createResolverFakes({
    tokenizer: staticTokenizer((text) => text.length),
  });
}

describe("PromptText user-prompt resolution", () => {
  it("lowers a direct value to provider-neutral text and inspection", async () => {
    const fakes = charTokenizerFakes();
    const pass = await compilePrompt(
      config({ prompt: md`Question ${"one"}` }),
      { ports: fakes.ports },
    ).resolve();

    expect(pass.args.prompt).toBe("Question one");
    expect(typeof pass.args.prompt).toBe("string");
    expect(isPromptText(pass.args.prompt)).toBe(false);
    expect(pass.inspect().prompt).toEqual({
      text: "Question one",
      tokens: 12,
      segments: [
        { text: "Question ", dynamic: false },
        { text: "one", dynamic: true },
      ],
      staticTokens: 9,
      dynamicTokens: 3,
    });
  });

  it("retains structural segments from a synchronous callback", async () => {
    const fakes = charTokenizerFakes();
    const pass = await compilePrompt(
      config({
        input: z.object({ question: z.string() }),
        prompt: ({ input }: { input: { question: string } }) =>
          md`Ask ${input.question}`,
      }),
      { ports: fakes.ports },
    ).resolve({ input: { question: "why" } });

    expect(pass.args.prompt).toBe("Ask why");
    expect(pass.inspect().prompt).toEqual({
      text: "Ask why",
      tokens: 7,
      segments: [
        { text: "Ask ", dynamic: false },
        { text: "why", dynamic: true },
      ],
      staticTokens: 4,
      dynamicTokens: 3,
    });
  });

  it("omits an empty lowered prompt", async () => {
    const pass = await compilePrompt(
      config({ prompt: md`${undefined}` }),
    ).resolve();

    expect(pass.args).not.toHaveProperty("prompt");
    expect(pass.inspect().prompt).toBeUndefined();
  });

  it("keeps an undefined prompt absent even when adaptations exist", async () => {
    const pass = await compilePrompt({
      adapt: {
        openai: {
          prependPrompt: "unused",
          appendPrompt: "unused",
        },
      },
    }).resolve({ provider: "openai" });

    expect(pass.args).not.toHaveProperty("prompt");
    expect(pass.inspect().prompt).toBeUndefined();
  });

  it("adds adaptations as static boundary segments", async () => {
    const fakes = charTokenizerFakes();
    const pass = await compilePrompt(
      config({
        prompt: md`Question ${"one"}?`,
        adapt: {
          openai: {
            prependPrompt: "[",
            appendPrompt: "]",
          },
        },
      }),
      { ports: fakes.ports },
    ).resolve({ provider: "openai" });

    expect(pass.args.prompt).toBe("[Question one?]");
    expect(pass.inspect().prompt).toEqual({
      text: "[Question one?]",
      tokens: 15,
      segments: [
        { text: "[Question ", dynamic: false },
        { text: "one", dynamic: true },
        { text: "?]", dynamic: false },
      ],
      staticTokens: 12,
      dynamicTokens: 3,
    });
  });

  it("keeps ordinary-string inspection byte-compatible and unsegmented", async () => {
    const fakes = charTokenizerFakes();
    const pass = await compilePrompt(
      {
        prompt: " question ",
        adapt: {
          openai: {
            prependPrompt: "[",
            appendPrompt: "]",
          },
        },
      },
      { ports: fakes.ports },
    ).resolve({ provider: "openai" });

    expect(pass.args.prompt).toBe("[ question ]");
    expect(pass.inspect().prompt).toEqual({
      text: "[ question ]",
      tokens: 12,
    });
  });

  it("runs sanitization and top-level auto-escape before md construction", async () => {
    const fakes = createResolverFakes({ policy: { autoEscape: true } });
    let sanitizeCalls = 0;
    let callbackCalls = 0;
    const pass = await compilePrompt(
      config({
        input: z.object({ escaped: z.string(), raw: z.string() }),
        rawFields: ["raw"],
        sanitize: (input: { escaped: string; raw: string }) => {
          sanitizeCalls += 1;
          return { ...input, escaped: `${input.escaped}!` };
        },
        prompt: ({ input }: { input: { escaped: string; raw: string } }) => {
          callbackCalls += 1;
          return md`${input.escaped}|${input.raw}`;
        },
      }),
      { ports: fakes.ports },
    ).resolve({ input: { escaped: "<unsafe>", raw: "<trusted>" } });

    expect(pass.args.prompt).toBe("&lt;unsafe&gt;!|<trusted>");
    expect(sanitizeCalls).toBe(1);
    expect(callbackCalls).toBe(1);
  });

  it("keeps md.json verbatim rather than treating it as sanitization", async () => {
    const pass = await compilePrompt(
      config({
        prompt: md`
          ${md.json({ html: "<unsafe>" })}
        `,
      }),
    ).resolve();

    expect(pass.args.prompt).toBe('{\n  "html": "<unsafe>"\n}');
  });

  it("adds prompt-field ownership only to stable PromptText errors", async () => {
    const invalid = { secret: "SENTINEL_USER_PROMPT_SECRET" };
    const failure = compilePrompt(
      config({
        id: "support",
        prompt: () => md`${invalid as never}`,
      }),
    ).resolve();
    const error = await failure.catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      name: "PromptTextError",
      code: "CRUX_PROMPT_TEXT_INVALID_INTERPOLATION",
      interpolationIndex: 0,
      interpolationPath: [],
    });
    expect((error as Error).message).toContain(
      'in prompt "support" field "prompt"',
    );
    expect((error as Error).message).not.toContain(invalid.secret);

    const unrelated = new Error("user callback failed");
    await expect(
      compilePrompt(
        config({
          id: "untouched",
          prompt: () => {
            throw unrelated;
          },
        }),
      ).resolve(),
    ).rejects.toBe(unrelated);
  });

  it("adds each owner only once when a callback rethrows a retained PromptText error", async () => {
    let retained: unknown;
    try {
      md`${{ invalid: true } as never}`;
    } catch (error) {
      retained = error;
    }

    const compiled = compilePrompt(
      config({
        id: "support",
        prompt: () => {
          throw retained;
        },
      }),
    );
    const first = await compiled.resolve().catch((error: unknown) => error);
    const second = await compiled.resolve().catch((error: unknown) => error);

    expect(first).toBe(retained);
    expect(second).toBe(retained);
    expect(
      (retained as Error).message.match(/in prompt "support" field "prompt"/g),
    ).toHaveLength(1);
  });

  it("rejects unsupported async user-prompt callbacks with an actionable error", async () => {
    const failure = compilePrompt(
      config({
        prompt: async () => "answer",
      }),
    ).resolve();

    await expect(failure).rejects.toThrow(
      "Prompt callbacks must be synchronous; Promise results are not supported",
    );
  });

  it("consumes the rejection from an unsupported native Promise result", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const underlying = new Error("async callback failed");
      const failure = compilePrompt(
        config({
          prompt: async () => {
            throw underlying;
          },
        }),
      ).resolve();

      await expect(failure).rejects.toThrow(
        "Prompt callbacks must be synchronous; Promise results are not supported",
      );
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("does not observe arbitrary object properties while checking invalid results", async () => {
    let trapCount = 0;
    const hostile = new Proxy(Object.create(null) as object, {
      get() {
        trapCount += 1;
        throw new Error("get trap ran");
      },
      getPrototypeOf() {
        trapCount += 1;
        throw new Error("getPrototypeOf trap ran");
      },
    });
    const failure = compilePrompt(
      config({
        prompt: () => hostile as never,
      }),
    ).resolve();

    await expect(failure).rejects.toThrow(
      "Prompt function must return a string or PromptText, got object",
    );
    expect(trapCount).toBe(0);

    const revoked = Proxy.revocable(Object.create(null) as object, {});
    revoked.revoke();
    await expect(
      compilePrompt(
        config({
          prompt: () => revoked.proxy as never,
        }),
      ).resolve(),
    ).rejects.toThrow(
      "Prompt function must return a string or PromptText, got object",
    );
  });

  it("rethrows hostile Proxy callback errors without observation", async () => {
    let trapCount = 0;
    const hostile = new Proxy(new Error("hostile"), {
      getPrototypeOf() {
        trapCount += 1;
        throw new Error("proxy trap ran");
      },
    });
    const failure = compilePrompt(
      config({
        prompt: () => {
          throw hostile;
        },
      }),
      { ports: createResolverFakes().ports },
    ).resolve();

    let caught: unknown;
    await failure.catch((error: unknown) => {
      caught = error;
    });
    expect(caught).toBe(hostile);
    expect(trapCount).toBe(0);
  });
});
