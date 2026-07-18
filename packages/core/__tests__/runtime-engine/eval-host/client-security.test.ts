import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEvalHostClient,
  EvalHostClientTransportError,
} from "../../../src/runtime/eval-host";
import { fixtureRegistry, jobBody, TOKEN } from "./fixture";

afterEach(() => {
  vi.useRealTimers();
});

describe("Eval host client transport limits", () => {
  it.each(["manifest", "submit", "poll"] as const)(
    "bounds a never-settling %s request and aborts its transport",
    async (operation) => {
      vi.useFakeTimers();
      let request!: Request;
      const client = createEvalHostClient({
        baseUrl: "https://runtime.example/",
        token: TOKEN,
        requestTimeoutMs: 25,
        transport: (value) => {
          request = value;
          return new Promise<Response>(() => undefined);
        },
      });
      const pending =
        operation === "manifest"
          ? client.manifest()
          : operation === "submit"
            ? client.submit(jobBody(fixtureRegistry()))
            : client.poll("job-private-body-canary");
      void pending.catch(() => undefined);

      await vi.advanceTimersByTimeAsync(25);

      await expect(pending).rejects.toMatchObject({
        name: "EvalHostClientTransportError",
        code: "EVAL_HOST_REQUEST_TIMEOUT",
        operation,
      });
      expect(request.signal.aborted).toBe(true);
      expect(await rejectionText(pending)).not.toMatch(
        new RegExp(`${TOKEN}|private-body-canary`),
      );
    },
  );

  it("preserves an external caller abort without exposing its reason", async () => {
    const external = new AbortController();
    const client = createEvalHostClient({
      baseUrl: "https://runtime.example/",
      token: TOKEN,
      transport: () => new Promise<Response>(() => undefined),
    });
    const pending = client.manifest({ signal: external.signal });

    external.abort(new Error("external-private-abort-reason"));

    await expect(pending).rejects.toMatchObject({
      code: "EVAL_HOST_REQUEST_ABORTED",
      operation: "manifest",
    });
    expect(await rejectionText(pending)).not.toMatch(
      /external-private-abort-reason|eval-execute-capability/,
    );
  });

  it("applies the same request deadline while streaming the response body", async () => {
    vi.useFakeTimers();
    const body = new ReadableStream<Uint8Array>({
      pull: () => new Promise<void>(() => undefined),
    });
    const client = createEvalHostClient({
      baseUrl: "https://runtime.example/",
      token: TOKEN,
      requestTimeoutMs: 25,
      transport: async () => new Response(body),
    });
    const pending = client.manifest();
    void pending.catch(() => undefined);

    await vi.advanceTimersByTimeAsync(25);

    await expect(pending).rejects.toMatchObject({
      code: "EVAL_HOST_REQUEST_TIMEOUT",
      operation: "manifest",
    });
  });

  it("stops reading an oversized chunked response even when cancellation fails", async () => {
    const encoder = new TextEncoder();
    let pulls = 0;
    const responseBody = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls += 1;
          if (pulls === 1) {
            controller.enqueue(encoder.encode('"private-canary'));
            return;
          }
          if (pulls === 2) {
            controller.enqueue(encoder.encode('-response-body"'));
            return;
          }
          controller.error(new Error("read beyond response byte limit"));
        },
        cancel() {
          throw new Error("response source refused cancellation");
        },
      },
      { highWaterMark: 0 },
    );
    const client = createEvalHostClient({
      baseUrl: "https://runtime.example/",
      token: TOKEN,
      responseMaxBytes: 16,
      transport: async () => new Response(responseBody),
    });

    const pending = client.manifest();

    await expect(pending).rejects.toMatchObject({
      name: "EvalHostClientTransportError",
      code: "EVAL_HOST_RESPONSE_TOO_LARGE",
      operation: "manifest",
    });
    expect(pulls).toBe(2);
    expect(await rejectionText(pending)).not.toMatch(
      /private-canary|response-body|eval-execute-capability/,
    );
  });
});

async function rejectionText(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "";
  } catch (error) {
    expect(error).toBeInstanceOf(EvalHostClientTransportError);
    return String(error);
  }
}
