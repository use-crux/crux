import { expect, it, vi } from "vitest";

import { createNodeEvalHostRuntime } from "../../../src/eval/node/host/readiness";
import { TimeoutError } from "../../../src/generation/timeout";
import { connectionEnvironment, hydratedEntry, manifest } from "./fixture";

/** Register coordinator deadline-source selection behavior. */
export function defineRemoteDeadlineBehavior(): void {
  it.each([
    ["earlier Eval", { totalMs: 1_000 }, "eval", 1_000],
    ["absent Eval", undefined, "host", 10 * 60_000],
    ["equal Eval", { totalMs: 10 * 60_000 }, "eval", 10 * 60_000],
  ] as const)(
    "selects the %s deadline with deterministic provenance",
    async (_label, timeout, source, limitMs) => {
      vi.useFakeTimers();
      vi.setSystemTime(0);
      const entry = hydratedEntry(timeout === undefined ? {} : { timeout });
      let submitted: Record<string, unknown> | undefined;
      const runtime = createNodeEvalHostRuntime({
        entry,
        projectRoot: "/does-not-read-files",
        processEnvironment: connectionEnvironment(),
        transport: async (request) => {
          const path = new URL(request.url).pathname;
          if (path === "/manifest") {
            return Response.json(manifest(entry, "production"));
          }
          submitted = JSON.parse(await request.text()) as Record<
            string,
            unknown
          >;
          return Response.json(
            failedStatus(String(submitted.jobId), String(submitted.evalRunId)),
          );
        },
      });

      await expect(
        runtime.execute({
          evalId: "support",
          caseId: "refund",
          variant: "current",
          trial: 0,
          task: entry.eval,
          overrides: {},
          input: { question: "refund" },
        }),
      ).rejects.toThrow(/EVAL_JOB_EXECUTION_FAILED/);

      expect(submitted).toMatchObject({
        deadlineAt: new Date(limitMs).toISOString(),
        deadline: { source, limitMs },
      });
      vi.useRealTimers();
    },
  );

  it("maps only an Eval-owned V2 expiration to a canonical timeout", async () => {
    const entry = hydratedEntry({ timeout: { totalMs: 25 } });
    const runtime = createNodeEvalHostRuntime({
      entry,
      projectRoot: "/does-not-read-files",
      processEnvironment: connectionEnvironment(),
      transport: async (request) =>
        new URL(request.url).pathname === "/manifest"
          ? Response.json(manifest(entry, "production"))
          : Response.json(expiredStatus(await request.text())),
    });

    const rejection = runtime
      .execute({
        evalId: "support",
        caseId: "refund",
        variant: "current",
        trial: 0,
        task: entry.eval,
        overrides: {},
        input: { question: "refund" },
      })
      .catch((error: unknown) => error);

    await expect(rejection).resolves.toMatchObject({
      budget: "total",
      limitMs: 25,
    });
    expect(TimeoutError.isInstance(await rejection)).toBe(true);
  });

  it("settles an unpublished Eval deadline once after the bounded grace", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const entry = hydratedEntry({ timeout: { totalMs: 25 } });
    let polls = 0;
    let markSubmitted!: () => void;
    const submitted = new Promise<void>((resolve) => {
      markSubmitted = resolve;
    });
    const runtime = createNodeEvalHostRuntime({
      entry,
      projectRoot: "/does-not-read-files",
      processEnvironment: connectionEnvironment(),
      transport: async (request) => {
        const path = new URL(request.url).pathname;
        if (path === "/manifest") {
          return Response.json(manifest(entry, "production"));
        }
        if (request.method === "POST") {
          markSubmitted();
          return Response.json(acceptedStatus(await request.text()));
        }
        polls += 1;
        return Response.json(acceptedStatusForJob(path.slice("/jobs/".length)));
      },
    });
    const pending = runtime
      .execute({
        evalId: "support",
        caseId: "refund",
        variant: "current",
        trial: 0,
        task: entry.eval,
        overrides: {},
        input: { question: "refund" },
      })
      .catch((error: unknown) => error);

    await submitted;
    await vi.advanceTimersByTimeAsync(5_025);

    const error = await pending;
    expect(TimeoutError.isInstance(error)).toBe(true);
    expect(error).toMatchObject({ budget: "total", limitMs: 25 });
    const settledPolls = polls;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(polls).toBe(settledPolls);
    vi.useRealTimers();
  });
}

function failedStatus(jobId: string, evalRunId: string) {
  const timestamp = new Date(0).toISOString();
  return {
    jobId,
    evalRunId,
    attempt: 1,
    revision: 3,
    createdAt: timestamp,
    updatedAt: timestamp,
    status: "failed",
    error: {
      code: "EVAL_JOB_EXECUTION_FAILED",
      message: "The deployed Eval task failed.",
      retryable: false,
      phase: "execute",
    },
  };
}

function expiredStatus(requestText: string) {
  const request = JSON.parse(requestText) as {
    readonly jobId: string;
    readonly evalRunId: string;
  };
  return {
    ...failedStatus(request.jobId, request.evalRunId),
    status: "expired",
    timeout: {
      budget: "total",
      limitMs: 25,
      phase: "in_flight",
    },
  };
}

function acceptedStatus(requestText: string) {
  const request = JSON.parse(requestText) as {
    readonly jobId: string;
    readonly evalRunId: string;
  };
  return acceptedStatusForJob(request.jobId, request.evalRunId);
}

function acceptedStatusForJob(
  jobId: string,
  evalRunId = jobId.replace(/^job-/, "run-"),
) {
  const timestamp = new Date(0).toISOString();
  return {
    jobId,
    evalRunId,
    attempt: 1,
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    status: "accepted",
  };
}
