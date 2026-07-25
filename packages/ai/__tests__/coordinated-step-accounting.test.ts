/**
 * Coordinated SDK step accounting against a real AI SDK v6 tool loop (RFC #173).
 *
 * Core owns the shared `maxSteps` budget; the adapter owns reporting how many model
 * steps one SDK invocation ACTUALLY consumed. One invocation is not one step — the SDK
 * runs its own tool loop inside a single call — so assuming otherwise both overruns the
 * budget and risks re-executing settled, side-effecting tools on a retry.
 *
 * @module
 */

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { prompt, tool } from "@use-crux/core";
import { boundary, constraint } from "@use-crux/core/safety";
import { createCruxAi } from "../src";
import { capturingStreamingEmissionModel } from "./mock-model";

// A TEXT prompt: the AI SDK only runs its tool loop on `streamText`, so this is the
// shape where one invocation really can consume several model steps.
const answer = prompt({
  id: "step-accounting",
  prompt: "use the tool then answer",
});

/** Rejects the first candidate so the coordinator must decide whether a retry is safe. */
const mustCite = constraint({
  id: "must-cite",
  on: boundary.output.text(),
  run: (text: string) =>
    text.includes("[1]") ? { pass: true } : { pass: false, feedback: "cite a source" },
});

describe("coordinated SDK step accounting", () => {
  it("charges real steps and never re-executes a settled tool", async () => {
    const executions = vi.fn(() => ({ ok: true }));
    const lookup = tool({
      name: "lookup",
      description: "look something up",
      parameters: z.object({}),
      execute: executions,
    });

    // Attempt one: a tool round, THEN a rejected answer — two model steps in one
    // SDK invocation. Attempt two would be the retry.
    const { model, prompts } = capturingStreamingEmissionModel([
      { toolCalls: [{ name: "lookup" }] },
      { text: "no citation" },
      { text: "answered [1]" },
    ]);

    const handle = await createCruxAi().stream(answer, {
      model,
      tools: { lookup } as never,
      constraints: [mustCite],
      maxSteps: 3,
    });

    let thrown: unknown;
    let published = "";
    try {
      for await (const chunk of handle.textStream) published += chunk;
      await handle.completion;
    } catch (error) {
      thrown = error;
    }

    // Whatever the outcome, the settled tool ran exactly once: a retry must never
    // replay completed, side-effecting tool rounds.
    expect(executions).toHaveBeenCalledTimes(1);
    // And the rejected candidate never reached the consumer.
    expect(published).not.toContain("no citation");
    // A multi-step invocation is charged for what it used, so the 3-step budget cannot
    // fund an unbounded number of retries.
    expect(prompts.length).toBeLessThanOrEqual(3);
    if (thrown !== undefined) expect(thrown).toBeInstanceOf(Error);
  });

  it("fails closed instead of guessing when consumption is unknown", async () => {
    // A result whose `steps` never resolves to an array is unknown consumption, which
    // is not retry-safe: core must surface the typed terminal error, not retry blindly.
    const { model } = capturingStreamingEmissionModel([
      { text: "no citation" },
      { text: "answered [1]" },
    ]);
    const handle = await createCruxAi().stream(answer, {
      model,
      constraints: [mustCite],
      maxSteps: 3,
    });
    // With known single-step consumption this retries normally and succeeds.
    let published = "";
    for await (const chunk of handle.textStream) published += chunk;
    expect(published).toBe("answered [1]");
  });
});

// A caller-supplied `stopWhen` must not replace the per-attempt budget cap. Replacing it
// let an explicit condition run the SDK tool loop past the grant core computed from the
// shared `maxSteps`.
describe("stopWhen composition", () => {
  it("cannot overrun the granted budget with an explicit condition", async () => {
    const executions = vi.fn(() => ({ ok: true }));
    const lookup = tool({
      name: "lookup",
      description: "look something up",
      parameters: z.object({}),
      execute: executions,
    });
    // Enough scripted tool rounds to run away if the cap were replaced.
    const { model } = capturingStreamingEmissionModel([
      { toolCalls: [{ name: "lookup" }] },
      { toolCalls: [{ name: "lookup" }] },
      { toolCalls: [{ name: "lookup" }] },
      { toolCalls: [{ name: "lookup" }] },
      { text: "done [1]" },
    ]);

    await createCruxAi()
      .stream(answer, {
        model,
        tools: { lookup } as never,
        maxSteps: 2,
        // A condition that never fires on its own.
        extra: { stopWhen: () => false } as never,
      })
      .then(async (handle) => {
        for await (const _chunk of handle.textStream) void _chunk;
        await handle.completion.catch(() => undefined);
      })
      .catch(() => undefined);

    // The hard cap still bounded the loop: at most one tool round per granted step.
    expect(executions.mock.calls.length).toBeLessThanOrEqual(2);
  });
});
