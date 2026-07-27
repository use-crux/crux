import type {
  EvalHostJobStatusV2,
  EvalHostManifest,
  SubmitEvalJobV2,
} from "./types";
import { decodeEvalHostManifest } from "./validation/manifest";
import { decodeEvalHostJobStatus } from "./validation/status";
import {
  createEvalHostRequestControl,
  type EvalHostRequestControl,
} from "./client-control";
import {
  EvalHostClientError,
  EvalHostClientTransportError,
  type EvalHostClientOperation,
} from "./client-errors";

export {
  EvalHostClientError,
  EvalHostClientTransportError,
} from "./client-errors";
export type { EvalHostClientTransportErrorCode } from "./client-errors";

/** Default hard ceiling for one host request, including response streaming. */
export const EVAL_HOST_REQUEST_TIMEOUT_MS = 10_000;
/** Maximum coordinator response body retained before strict JSON decoding. */
export const EVAL_HOST_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

/** Fetch-shaped transport injected by coordinators and adapter conformance. */
export type EvalHostTransport = (request: Request) => Promise<Response>;

export interface EvalHostClientRequestOptions {
  /** Caller-owned cancellation propagated without retaining its reason. */
  readonly signal?: AbortSignal;
  /** Optional shorter deadline; cannot widen the client's hard ceiling. */
  readonly timeoutMs?: number;
}

/** Narrow authenticated V2 coordinator client with known-manifest reads. */
export interface EvalHostClient {
  manifest(options?: EvalHostClientRequestOptions): Promise<EvalHostManifest>;
  submit(
    job: SubmitEvalJobV2,
    options?: EvalHostClientRequestOptions,
  ): Promise<EvalHostJobStatusV2>;
  poll(
    jobId: string,
    options?: EvalHostClientRequestOptions,
  ): Promise<EvalHostJobStatusV2>;
  cancel(
    jobId: string,
    options?: EvalHostClientRequestOptions,
  ): Promise<EvalHostJobStatusV2>;
}

/** Create a transport-neutral client that sends only protocol identities. */
export function createEvalHostClient(options: {
  readonly baseUrl: string;
  readonly token: string;
  readonly transport?: EvalHostTransport;
  /** Hard request deadline. Values above the default remain capped. */
  readonly requestTimeoutMs?: number;
  /** Response ceiling override for constrained hosts and tests; may only lower it. */
  readonly responseMaxBytes?: number;
}): EvalHostClient {
  const transport = options.transport ?? ((request) => fetch(request));
  const requestTimeoutMs = boundedLimit(
    options.requestTimeoutMs,
    EVAL_HOST_REQUEST_TIMEOUT_MS,
    "Eval host request timeout",
  );
  const responseMaxBytes = boundedLimit(
    options.responseMaxBytes,
    EVAL_HOST_MAX_RESPONSE_BYTES,
    "Eval host response byte limit",
  );
  const request = async (
    operation: EvalHostClientOperation,
    path: string,
    init: RequestInit = {},
    requestOptions: EvalHostClientRequestOptions = {},
  ) => {
    const control = createEvalHostRequestControl({
      operation,
      timeoutMs: boundedLimit(
        requestOptions.timeoutMs,
        requestTimeoutMs,
        "Eval host per-request timeout",
      ),
      externalSignal: requestOptions.signal,
    });
    try {
      control.throwIfAborted();
      const response = await control.race(
        transport(
          new Request(new URL(path, trailingSlash(options.baseUrl)), {
            ...init,
            redirect: "manual",
            signal: control.signal,
            headers: {
              authorization: `Bearer ${options.token}`,
              "content-type": "application/json",
              ...init.headers,
            },
          }),
        ),
      );
      const body = await decodeBoundedJsonResponse(
        response,
        operation,
        responseMaxBytes,
        control,
      );
      if (!response.ok) throw new EvalHostClientError(response.status, body);
      return body;
    } catch (error) {
      if (
        error instanceof EvalHostClientError ||
        error instanceof EvalHostClientTransportError
      ) {
        throw error;
      }
      control.throwIfAborted();
      throw new EvalHostClientTransportError(
        "EVAL_HOST_TRANSPORT_FAILED",
        operation,
        "The Eval host request failed before a bounded response was received. Verify the selected host URL and deployment availability.",
      );
    } finally {
      control.dispose();
    }
  };
  return Object.freeze({
    manifest: async (requestOptions?: EvalHostClientRequestOptions) =>
      decodeEvalHostManifest(
        await request("manifest", "manifest", {}, requestOptions),
      ),
    submit: async (
      job: SubmitEvalJobV2,
      requestOptions?: EvalHostClientRequestOptions,
    ) =>
      decodeEvalHostJobStatus(
        await request(
          "submit",
          "jobs",
          { method: "POST", body: JSON.stringify(job) },
          requestOptions,
        ),
      ),
    poll: async (
      jobId: string,
      requestOptions?: EvalHostClientRequestOptions,
    ) =>
      decodeEvalHostJobStatus(
        await request(
          "poll",
          `jobs/${encodeURIComponent(jobId)}`,
          {},
          requestOptions,
        ),
      ),
    cancel: async (
      jobId: string,
      requestOptions?: EvalHostClientRequestOptions,
    ) =>
      decodeEvalHostJobStatus(
        await request(
          "cancel",
          `jobs/${encodeURIComponent(jobId)}`,
          { method: "DELETE" },
          requestOptions,
        ),
      ),
  });
}

async function decodeBoundedJsonResponse(
  response: Response,
  operation: EvalHostClientOperation,
  maxBytes: number,
  control: EvalHostRequestControl,
): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    cancelResponseBody(response.body);
    throw responseTooLarge(operation);
  }
  if (response.body === null) throw invalidResponse(operation);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await control.race(reader.read());
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        cancelReader(reader);
        throw responseTooLarge(operation);
      }
      chunks.push(value);
    }
  } catch (error) {
    cancelReader(reader);
    if (error instanceof EvalHostClientTransportError) throw error;
    throw new EvalHostClientTransportError(
      "EVAL_HOST_TRANSPORT_FAILED",
      operation,
      "The Eval host response stream failed before a complete bounded response was received. Verify host availability and retry.",
    );
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw invalidResponse(operation);
  }
}

function cancelResponseBody(body: ReadableStream<Uint8Array> | null): void {
  if (body === null) return;
  try {
    void body.cancel().catch(() => undefined);
  } catch {
    // A rejected response is already terminal; cancellation is best effort.
  }
}

function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  try {
    void reader.cancel().catch(() => undefined);
  } catch {
    // A rejected response is already terminal; cancellation is best effort.
  }
}

function responseTooLarge(
  operation: EvalHostClientOperation,
): EvalHostClientTransportError {
  return new EvalHostClientTransportError(
    "EVAL_HOST_RESPONSE_TOO_LARGE",
    operation,
    `The Eval host ${operation} response exceeded the coordinator byte limit. Reduce the deployed manifest/result size or inspect the selected host.`,
  );
}

function invalidResponse(
  operation: EvalHostClientOperation,
): EvalHostClientTransportError {
  return new EvalHostClientTransportError(
    "EVAL_HOST_INVALID_RESPONSE",
    operation,
    `The Eval host ${operation} response was not valid bounded JSON. Verify the selected Runtime deployment and protocol version.`,
  );
}

function boundedLimit(
  value: number | undefined,
  ceiling: number,
  label: string,
): number {
  if (value === undefined) return ceiling;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer.`);
  }
  return Math.min(value, ceiling);
}

function trailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}
