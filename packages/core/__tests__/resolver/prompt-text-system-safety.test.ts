import { describe, expect, it } from "vitest";
import { z } from "zod";
import { md } from "../../src/prompt-text";
import {
  compilePrompt,
  context,
  createResolverFakes,
  type AnyPromptConfig,
} from "../../src/index";

function config(value: unknown): AnyPromptConfig {
  return value as AnyPromptConfig;
}

describe("PromptText system safety and compatibility", () => {
  it("runs sanitization and auto-escape once before callback lowering", async () => {
    const fakes = createResolverFakes({ policy: { autoEscape: true } });
    let sanitizeCalls = 0;
    let callbackCalls = 0;

    const pass = await compilePrompt(
      config({
        input: z.object({ value: z.string() }),
        sanitize: (input: { value: string }) => {
          sanitizeCalls += 1;
          return { value: `${input.value}!` };
        },
        system: ({ input }: { input: { value: string } }) => {
          callbackCalls += 1;
          return md`Value: ${input.value}`;
        },
      }),
      { ports: fakes.ports },
    ).resolve({ input: { value: "<unsafe>" } });

    expect(pass.args.system).toBe("Value: &lt;unsafe&gt;!");
    expect(sanitizeCalls).toBe(1);
    expect(callbackCalls).toBe(1);
  });

  it("adds prompt and context ownership only to PromptText errors", async () => {
    const secret = "SENTINEL_PROMPT_TEXT_SECRET";
    const invalid = { secretKey: secret };
    const cause = new Error("root cause");
    const promptError = await compilePrompt(
      config({
        id: "support",
        system: () => {
          try {
            return md`${invalid as never}`;
          } catch (error) {
            (error as Error & { cause?: unknown }).cause = cause;
            throw error;
          }
        },
      }),
    )
      .resolve()
      .catch((caught: unknown) => caught);
    const badContext = context({
      id: "account",
      system: () => md`${invalid as never}`,
    });
    const contextError = await compilePrompt(config({ use: [badContext] }))
      .resolve()
      .catch((caught: unknown) => caught);

    for (const [error, owner] of [
      [promptError, 'in prompt "support" field "system"'],
      [contextError, 'in context "account" field "system"'],
    ] as const) {
      expect(error).toMatchObject({
        name: "PromptTextError",
        code: "CRUX_PROMPT_TEXT_INVALID_INTERPOLATION",
        interpolationIndex: 0,
        interpolationPath: [],
      });
      expect((error as Error).message).toContain(owner);
      expect((error as Error).message).toContain(
        "select a scalar field, return a fragment, or use md.json() for intentional JSON",
      );
      expect((error as Error).message).not.toContain(secret);
      expect(JSON.stringify(error)).not.toContain(secret);
    }
    expect((promptError as Error & { cause?: unknown }).cause).toBe(cause);

    const unrelated = new Error("user callback failed");
    const unrelatedFailure = compilePrompt(
      config({
        id: "untouched",
        system: () => {
          throw unrelated;
        },
      }),
    ).resolve();
    await expect(unrelatedFailure).rejects.toBe(unrelated);
  });

  it("preserves ordinary system strings byte-for-byte", async () => {
    const exact = "\n  Keep this indentation.\t\n";
    const pass = await compilePrompt({ system: exact }).resolve();

    expect(pass.args.system).toBe(exact);
    expect(pass.inspect().system.parts[0]).toMatchObject({
      text: exact,
      segments: [{ text: exact, dynamic: false }],
    });
  });

  it("lists PromptText among the accepted system callback results", async () => {
    const failure = compilePrompt(
      config({
        system: () => 42,
      }),
    ).resolve();

    await expect(failure).rejects.toThrow(
      "Prompt system/context function must return a string, PromptText, or { segments }, got number. Value: 42",
    );
  });

  it("rethrows hostile and revoked Proxy callback errors by identity", async () => {
    let trapCount = 0;
    const hostile = new Proxy(new Error("hostile"), {
      getPrototypeOf() {
        trapCount += 1;
        throw new Error("proxy trap ran");
      },
    });
    const revoked = Proxy.revocable(new Error("revoked"), {});
    revoked.revoke();
    const badContext = context({
      id: "revoked-error",
      system: () => {
        throw revoked.proxy;
      },
    });

    const promptFailure = compilePrompt(
      config({
        system: () => {
          throw hostile;
        },
      }),
      { ports: createResolverFakes().ports },
    ).resolve();
    let promptCaught: unknown;
    await promptFailure.catch((error: unknown) => {
      promptCaught = error;
    });
    const contextFailure = compilePrompt(config({ use: [badContext] }), {
      ports: createResolverFakes().ports,
    }).resolve();
    let contextCaught: unknown;
    await contextFailure.catch((error: unknown) => {
      contextCaught = error;
    });

    expect(promptCaught).toBe(hostile);
    expect(contextCaught).toBe(revoked.proxy);
    expect(trapCount).toBe(0);
  });
});
