import { expect, it, vi } from "vitest";
import { pollEvalHostJobForInternalUse } from "../../../src/eval/node/host/readiness";
import type {
  EvalHostClient,
  EvalHostJobStatusV1,
} from "../../../src/runtime/eval-host";
import {
  createEvalHostClient,
  type EvalHostClientTransportError,
} from "../../../src/runtime/eval-host";

function acceptedStatus(): EvalHostJobStatusV1 {
  return {
    jobId: "job-1",
    evalRunId: "run-1",
    attempt: 1,
    revision: 1,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    status: "accepted",
  };
}

function succeededStatus(
  accepted: EvalHostJobStatusV1,
): EvalHostJobStatusV1 {
  return {
    ...accepted,
    status: "succeeded",
    resultRef: {
      sha256: "a".repeat(64),
      size: 2,
      mediaType: "application/vnd.crux.eval-result+json",
      location: "memory://results/result-1",
    },
    result: {},
  };
}

/** Register deadline-aware polling and bounded publication-grace behavior. */
export function pollDeadlineBehavior(): void {
  it("polls until the admitted deadline instead of a fixed attempt count", async () => {
    let now = 0;
    let polls = 0;
    const accepted = acceptedStatus();
    const succeeded = succeededStatus(accepted);
    const transport = vi.fn(async () =>
      Response.json(++polls > 150 ? succeeded : accepted),
    );
    const client = createEvalHostClient({
      baseUrl: "https://runtime.example/",
      token: "poll-token-that-must-not-be-retained",
      transport,
    });

    await expect(
      pollEvalHostJobForInternalUse(client, accepted, 20_000, {
        now: () => now,
        sleep: async (durationMs) => {
          now += durationMs;
        },
        pollIntervalMs: 100,
      }),
    ).resolves.toMatchObject({ status: "succeeded" });
    expect(transport).toHaveBeenCalledTimes(151);
  });

  it("accepts terminal publication after sleeping to the admitted deadline", async () => {
    let now = 0;
    const accepted = acceptedStatus();
    const succeeded = succeededStatus(accepted);
    const client = {
      poll: vi.fn(async () => succeeded),
    } as unknown as EvalHostClient;

    await expect(
      pollEvalHostJobForInternalUse(client, accepted, 25, {
        now: () => now,
        sleep: async (durationMs) => {
          now += durationMs;
        },
        pollIntervalMs: 100,
      }),
    ).resolves.toBe(succeeded);
    expect(client.poll).toHaveBeenCalledOnce();
  });

  it("bounds an in-flight poll by the deadline plus terminal grace", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const accepted = acceptedStatus();
    const client = createEvalHostClient({
      baseUrl: "https://runtime.example/",
      token: "poll-token-that-must-not-be-retained",
      requestTimeoutMs: 1_000,
      transport: () => new Promise<Response>(() => undefined),
    });
    const pending = pollEvalHostJobForInternalUse(client, accepted, 25, {
      pollIntervalMs: 0,
    });

    await vi.advanceTimersByTimeAsync(5_025);

    await expect(pending).resolves.toBe(accepted);
  });

  it("surfaces a shorter per-request timeout while overall time remains", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const accepted = acceptedStatus();
    const client = createEvalHostClient({
      baseUrl: "https://runtime.example/",
      token: "poll-token-that-must-not-be-retained",
      requestTimeoutMs: 1_000,
      transport: () => new Promise<Response>(() => undefined),
    });
    const pending = pollEvalHostJobForInternalUse(client, accepted, 1_000, {
      pollIntervalMs: 0,
      requestTimeoutMs: 10,
    });
    void pending.catch(() => undefined);

    await vi.advanceTimersByTimeAsync(10);

    await expect(pending).rejects.toMatchObject({
      name: "EvalHostClientTransportError",
      code: "EVAL_HOST_REQUEST_TIMEOUT",
      operation: "poll",
    } satisfies Partial<EvalHostClientTransportError>);
  });
}
