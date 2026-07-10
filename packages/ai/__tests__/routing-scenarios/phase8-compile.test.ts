/**
 * Compile-only walkthrough scenarios for the stable routing API.
 *
 * These functions are intentionally not invoked. The test body is a no-op so
 * Vitest can load the file without making provider calls, while `tsc` still
 * checks the examples against the public `@use-crux/ai` surface.
 */

import type { LanguageModel } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { CruxAi } from "../../src/index";
import { prompt } from "@use-crux/core";
import {
  cascade,
  fallback,
  retry,
  router,
  split,
  type RouteArgs,
} from "@use-crux/core/routing";

declare const ai: CruxAi;
declare const gpt4o: LanguageModel;
declare const gpt4oMini: LanguageModel;
declare const gpt5: LanguageModel;
declare const gpt5Mini: LanguageModel;
declare const claudeHaiku: LanguageModel;
declare const claudeSonnet: LanguageModel;
declare const claudeOpus: LanguageModel;

type Tier = "free" | "pro" | "enterprise";

interface AuthRouting {
  readonly tier: Tier;
  readonly tenantId: string;
  readonly betaModelOverride?: boolean;
}

const supportPrompt = prompt({
  id: "routing-scenario-support",
  input: z.object({ question: z.string() }),
  output: z.object({ text: z.string() }),
  system: "Answer the support request.",
});

const chatPrompt = prompt({
  id: "routing-scenario-chat",
  input: z.object({ message: z.string() }),
  system: "Chat with the user.",
});

const invoicePrompt = prompt({
  id: "routing-scenario-invoice",
  input: z.object({ pdfText: z.string() }),
  output: z.object({ total: z.number(), lines: z.array(z.string()) }),
  system: "Extract invoice fields.",
});

function scenario1SaasTierRouting(auth: AuthRouting, question: string) {
  const supportModel = router({
    id: "support-tier-router",
    classify: ({ input, context }: RouteArgs<AuthRouting, { readonly question: string }>) => {
      if (context.betaModelOverride) return "best";
      if (context.tier === "free") return "cheap";
      if (context.tier === "pro") return "mid";
      return input.question.length > 2_000 ? "best" : "mid";
    },
    routes: {
      cheap: gpt4oMini,
      mid: gpt5Mini,
      best: gpt5,
      default: gpt4oMini,
    },
  });

  void ai.generate(supportPrompt, {
    model: supportModel,
    input: { question },
    routing: auth,
    route: "best",
  });

  // @ts-expect-error routing context is required and must stay out of prompt input.
  void ai.generate(supportPrompt, { model: supportModel, input: { question } });
}

function scenario2LaunchDayResilience(question: string) {
  const resilient = fallback(
    [retry(gpt5, { attempts: 2, backoff: "exponential" }), claudeSonnet],
    {
      id: "launch-day-primary-then-backup",
      on: ["rate_limit", "timeout", "server_error", "connection_error"],
      timeout: { attempt: 10_000, firstToken: 3_000 },
      onFallback: async ({ from, to, attempt, error }) => {
        void from;
        void to;
        void attempt;
        void error.message;
      },
    },
  );

  void ai.generate(supportPrompt, {
    model: resilient,
    input: { question },
    timeout: { totalMs: 45_000 },
  });
}

function scenario3StructuredOutputPipeline(pdfText: string) {
  const extraction = cascade({
    prompt: invoicePrompt,
    tiers: [
      {
        model: fallback([gpt4oMini, claudeHaiku], {
          on: ["rate_limit", "server_error", "connection_error"],
        }),
        escalateOn: ["invalid_response"],
      },
      { model: gpt5Mini },
      { model: claudeSonnet },
    ],
  });

  void ai.generate(invoicePrompt, {
    model: extraction,
    input: { pdfText },
    validationRetry: { maxRetries: 2 },
  });

  // @ts-expect-error prompt-bound cascades reject the wrong prompt.
  void ai.generate(supportPrompt, { model: extraction, input: { question: "x" } });
}

function scenario4CostGatedJudgeCascade(question: string) {
  const answerModel = cascade({
    prompt: supportPrompt,
    budget: { maxCost: 0.05 },
    tiers: [
      {
        model: claudeHaiku,
        budget: 0.8,
        evaluate: async ({ result, input, totalCost, report }) => {
          const judged = await report(Promise.resolve({ score: 0.9, cost: 0.002 }));
          return {
            accepted: result.text.length > 0 && input.question === question && totalCost < 0.05 && judged.score >= 0.8,
            confidence: judged.score,
            budget: 0.8,
          };
        },
      },
      { model: claudeOpus },
    ],
  });

  void ai.generate(supportPrompt, {
    model: answerModel,
    input: { question },
  });
}

function scenario5StreamingChat(message: string, messageCount: number) {
  const chatModel = router({
    id: "chat-length-router",
    classify: ({ context }: RouteArgs<{ readonly messageCount: number }>) =>
      context.messageCount > 20 ? "long" : "short",
    routes: {
      short: fallback([gpt4oMini, claudeHaiku]),
      long: fallback([gpt5Mini, claudeSonnet]),
      default: gpt4oMini,
    },
  });

  void ai.stream(chatPrompt, {
    model: chatModel,
    input: { message },
    routing: { messageCount },
  });

  const nonStreamable = cascade({
    prompt: chatPrompt,
    tiers: [{ model: gpt4oMini }],
  });

  // @ts-expect-error cascades are generate-only, even when used with stream().
  void ai.stream(chatPrompt, { model: nonStreamable, input: { message } });
}

function scenario7CanaryRollout(question: string, sessionId: string) {
  const canary = split({
    id: "support-canary-gpt5mini",
    seed: ({ context }: RouteArgs<{ readonly sessionId: string }>) => context.sessionId,
    routes: {
      stable: { model: gpt4o, weight: 95 },
      canary: { model: gpt5Mini, weight: 5 },
    },
  });

  void ai.generate(supportPrompt, {
    model: canary,
    input: { question },
    routing: { sessionId },
    route: "canary",
  });
}

describe("Phase 8 routing walkthrough scenarios", () => {
  it("compile against the public AI adapter surface", () => {
    void scenario1SaasTierRouting;
    void scenario2LaunchDayResilience;
    void scenario3StructuredOutputPipeline;
    void scenario4CostGatedJudgeCascade;
    void scenario5StreamingChat;
    void scenario7CanaryRollout;
    expect(true).toBe(true);
  });
});
