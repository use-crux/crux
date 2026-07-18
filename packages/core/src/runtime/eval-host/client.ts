import type {
  EvalHostJobStatusV1,
  EvalHostManifestV1,
  SubmitEvalJobV1,
} from "./types";
import { decodeEvalHostManifest } from "./validation/manifest";
import { decodeEvalHostJobStatus } from "./validation/status";

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

/** Narrow authenticated coordinator client for Eval host V1. */
export interface EvalHostClient {
  manifest(options?: EvalHostClientRequestOptions): Promise<EvalHostManifestV1>;
  submit(
    job: SubmitEvalJobV1,
    options?: EvalHostClientRequestOptions,
  ): Promise<EvalHostJobStatusV1>;
  poll(
    jobId: string,
    options?: EvalHostClientRequestOptions,
  ): Promise<EvalHostJobStatusV1>;
  cancel(
    jobId: string,
    options?: EvalHostClientRequestOptions,
  ): Promise<EvalHostJobStatusV1>;
}

type EvalHostClientOperation = "manifest" | "submit" | "poll" | "cancel";

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
    const control = createRequestControl({
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
      job: SubmitEvalJobV1,
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

/** HTTP failure retaining the decoded, byte-bounded host error body. */
export class EvalHostClientError extends Error {
  override readonly name = "EvalHostClientError";
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`Eval host request failed with HTTP ${status}.`);
  }
}

export type EvalHostClientTransportErrorCode =
  | "EVAL_HOST_REQUEST_TIMEOUT"
  | "EVAL_HOST_REQUEST_ABORTED"
  | "EVAL_HOST_RESPONSE_TOO_LARGE"
  | "EVAL_HOST_INVALID_RESPONSE"
  | "EVAL_HOST_TRANSPORT_FAILED";

/** Stable transport diagnostic that never retains request credentials or bodies. */
export class EvalHostClientTransportError extends Error {
  override readonly name = "EvalHostClientTransportError";
  constructor(
    readonly code: EvalHostClientTransportErrorCode,
    readonly operation: EvalHostClientOperation,
    message: string,
  ) {
    super(message);
  }
}

interface RequestControl {
  readonly signal: AbortSignal;
  race<T>(promise: Promise<T>): Promise<T>;
  throwIfAborted(): void;
  dispose(): void;
}

function createRequestControl(input: {
  readonly operation: EvalHostClientOperation;
  readonly timeoutMs: number;
  readonly externalSignal?: AbortSignal;
}): RequestControl {
  const controller = new AbortController();
  let failure: EvalHostClientTransportError | undefined;
  let rejectAbort!: (error: EvalHostClientTransportError) => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  // The timer or caller may abort before a hostile transport reaches race().
  // Keep that rejection observed without changing what race() propagates.
  void aborted.catch(() => undefined);
  const abort = (kind: "timeout" | "external") => {
    if (failure !== undefined) return;
    failure =
      kind === "timeout"
        ? new EvalHostClientTransportError(
            "EVAL_HOST_REQUEST_TIMEOUT",
            input.operation,
            `The Eval host ${input.operation} request exceeded its bounded deadline. Verify host availability or retry the Eval.`,
          )
        : new EvalHostClientTransportError(
            "EVAL_HOST_REQUEST_ABORTED",
            input.operation,
            `The Eval host ${input.operation} request was cancelled by its caller.`,
          );
    controller.abort();
    rejectAbort(failure);
  };
  const onExternalAbort = () => abort("external");
  if (input.externalSignal?.aborted) onExternalAbort();
  else
    input.externalSignal?.addEventListener("abort", onExternalAbort, {
      once: true,
    });
  const timer = setTimeout(() => abort("timeout"), input.timeoutMs);
  return {
    signal: controller.signal,
    race: <T>(promise: Promise<T>) => Promise.race([promise, aborted]),
    throwIfAborted() {
      if (failure !== undefined) throw failure;
    },
    dispose() {
      clearTimeout(timer);
      input.externalSignal?.removeEventListener("abort", onExternalAbort);
    },
  };
}

async function decodeBoundedJsonResponse(
  response: Response,
  operation: EvalHostClientOperation,
  maxBytes: number,
  control: RequestControl,
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
