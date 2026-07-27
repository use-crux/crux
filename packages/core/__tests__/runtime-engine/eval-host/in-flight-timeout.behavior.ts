import { expect, it, vi } from "vitest";

import { TimeoutError } from "../../../src/generation/timeout";
import {
  createMemoryEvalHost,
  decodeEvalHostJobStatusV2,
} from "../../../src/runtime/eval-host";
import type { EvalTaskExecutionContext } from "../../../src/eval/internal/task-execution-context";
import {
  authorizedRequest,
  fixtureRegistry,
  HOST_CAPABILITIES,
  jobBody,
  NOW,
  pollUntilTerminal,
  post,
  TOKEN,
} from "./fixture";

/** Register in-flight V2 timeout behavior through the real Runtime host. */
export function defineInFlightTimeoutBehavior(): void {
  it("aborts the task signal and expires without awaiting ignored work", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    let release!: () => void;
    let started!: () => void;
    let taskContext: EvalTaskExecutionContext | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    const registry = fixtureRegistry(
      async (input, _call, _overrides, context) => {
        taskContext = context;
        started();
        await gate;
        return { output: input };
      },
      HOST_CAPABILITIES,
      "generate",
      [],
      undefined,
      { totalMs: 25 },
    );
    const host = createMemoryEvalHost({
      deploymentId: "production-eu",
      token: TOKEN,
      registry,
      hostCapabilities: HOST_CAPABILITIES,
      now: () => new Date(Date.now()),
    });
    const publishResult = vi.spyOn(host.store.results, "put");
    const deadlineAt = NOW.getTime() + 25;
    const body = {
      ...jobBody(registry),
      deadlineAt: new Date(deadlineAt).toISOString(),
      deadline: { source: "eval", limitMs: 25 } as const,
    };

    try {
      await host.fetch(authorizedRequest("/jobs", post(body)));
      await running;
      await vi.advanceTimersByTimeAsync(25);

      await expect(
        (await host.fetch(authorizedRequest(`/jobs/${body.jobId}`))).json(),
      ).resolves.toMatchObject({
        status: "expired",
        timeout: {
          budget: "total",
          limitMs: 25,
          phase: "in_flight",
        },
      });
      expect(taskContext?.signal.aborted).toBe(true);
      expect(TimeoutError.isInstance(taskContext?.signal.reason)).toBe(true);

      release();
      await vi.runAllTimersAsync();
      await Promise.resolve();
      expect(publishResult).not.toHaveBeenCalled();
      await expect(
        (await host.fetch(authorizedRequest(`/jobs/${body.jobId}`))).json(),
      ).resolves.toMatchObject({ status: "expired" });
    } finally {
      release();
      await vi.runAllTimersAsync();
      vi.useRealTimers();
    }
  });

  it("reports pre-start expiration without invoking the admitted task", async () => {
    let clockCalls = 0;
    const execute = vi.fn(async (input: unknown) => ({ output: input }));
    const registry = fixtureRegistry(
      execute,
      HOST_CAPABILITIES,
      "generate",
      [],
      undefined,
      { totalMs: 30_000 },
    );
    const host = createMemoryEvalHost({
      deploymentId: "production-eu",
      token: TOKEN,
      registry,
      hostCapabilities: HOST_CAPABILITIES,
      now: () => new Date(NOW.getTime() + clockCalls++ * 60_000),
    });
    const body = {
      ...jobBody(registry),
      deadlineAt: new Date(NOW.getTime() + 30_000).toISOString(),
      deadline: { source: "eval", limitMs: 30_000 } as const,
    };

    const accepted = await host.fetch(authorizedRequest("/jobs", post(body)));
    expect(accepted.status).toBe(202);
    await expect(pollUntilTerminal(host, body.jobId)).resolves.toMatchObject({
      status: "expired",
      timeout: {
        budget: "total",
        limitMs: 30_000,
        phase: "pre_start",
      },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("consumes a task rejection that arrives after in-flight expiration", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    let rejectTask!: (error: Error) => void;
    let started!: () => void;
    const gate = new Promise<never>((_resolve, reject) => {
      rejectTask = reject;
    });
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    const registry = fixtureRegistry(
      async () => {
        started();
        return await gate;
      },
      HOST_CAPABILITIES,
      "generate",
      [],
      undefined,
      { totalMs: 25 },
    );
    const host = createMemoryEvalHost({
      deploymentId: "production-eu",
      token: TOKEN,
      registry,
      hostCapabilities: HOST_CAPABILITIES,
      now: () => new Date(Date.now()),
    });
    const publishResult = vi.spyOn(host.store.results, "put");
    const body = {
      ...jobBody(registry),
      deadlineAt: new Date(NOW.getTime() + 25).toISOString(),
      deadline: { source: "eval", limitMs: 25 } as const,
    };

    try {
      await host.fetch(authorizedRequest("/jobs", post(body)));
      await running;
      await vi.advanceTimersByTimeAsync(25);
      rejectTask(new Error("late-private-provider-rejection"));
      await vi.runAllTimersAsync();
      await Promise.resolve();

      expect(publishResult).not.toHaveBeenCalled();
      await expect(
        (await host.fetch(authorizedRequest(`/jobs/${body.jobId}`))).json(),
      ).resolves.toMatchObject({ status: "expired" });
    } finally {
      rejectTask(new Error("cleanup"));
      await vi.runAllTimersAsync();
      vi.useRealTimers();
    }
  });

  it("preserves canonical nested timeout metadata in the V2 terminal", async () => {
    const registry = fixtureRegistry(async () => {
      throw new TimeoutError({
        budget: "tool",
        limitMs: 500,
        toolName: "search",
      });
    });
    const host = createMemoryEvalHost({
      deploymentId: "production-eu",
      token: TOKEN,
      registry,
      hostCapabilities: HOST_CAPABILITIES,
      now: () => NOW,
    });
    const body = jobBody(registry);

    await host.fetch(authorizedRequest("/jobs", post(body)));

    await expect(pollUntilTerminal(host, body.jobId)).resolves.toMatchObject({
      status: "expired",
      timeout: {
        budget: "tool",
        limitMs: 500,
        toolName: "search",
        phase: "in_flight",
      },
    });
  });

  it("round-trips chunk timeout metadata without admitting a non-Tool name", async () => {
    const registry = fixtureRegistry(async () => {
      throw new TimeoutError({
        budget: "chunk",
        limitMs: 750,
      });
    });
    const host = createMemoryEvalHost({
      deploymentId: "production-eu",
      token: TOKEN,
      registry,
      hostCapabilities: HOST_CAPABILITIES,
      now: () => NOW,
    });
    const body = jobBody(registry);

    await host.fetch(authorizedRequest("/jobs", post(body)));

    const terminal = decodeEvalHostJobStatusV2(
      await pollUntilTerminal(host, body.jobId),
    );
    expect(terminal).toMatchObject({
      status: "expired",
      timeout: {
        budget: "chunk",
        limitMs: 750,
        phase: "in_flight",
      },
    });
    expect(() =>
      decodeEvalHostJobStatusV2({
        ...terminal,
        timeout: {
          budget: "chunk",
          limitMs: 750,
          toolName: "search",
          phase: "in_flight",
        },
      }),
    ).toThrow(/incompatible job status/i);
  });
}
