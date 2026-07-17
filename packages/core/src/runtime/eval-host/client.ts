import type {
  EvalHostJobStatusV1,
  EvalHostManifestV1,
  SubmitEvalJobV1,
} from "./types";
import { decodeEvalHostManifest } from "./validation/manifest";
import { decodeEvalHostJobStatus } from "./validation/status";

/** Fetch-shaped transport injected by coordinators and adapter conformance. */
export type EvalHostTransport = (request: Request) => Promise<Response>;

/** Narrow authenticated coordinator client for Eval host V1. */
export interface EvalHostClient {
  manifest(): Promise<EvalHostManifestV1>;
  submit(job: SubmitEvalJobV1): Promise<EvalHostJobStatusV1>;
  poll(jobId: string): Promise<EvalHostJobStatusV1>;
  cancel(jobId: string): Promise<EvalHostJobStatusV1>;
}

/** Create a transport-neutral client that sends only protocol identities. */
export function createEvalHostClient(options: {
  readonly baseUrl: string;
  readonly token: string;
  readonly transport?: EvalHostTransport;
}): EvalHostClient {
  const transport = options.transport ?? ((request) => fetch(request));
  const request = async (path: string, init: RequestInit = {}) => {
    const response = await transport(
      new Request(new URL(path, trailingSlash(options.baseUrl)), {
        ...init,
        redirect: "manual",
        headers: {
          authorization: `Bearer ${options.token}`,
          "content-type": "application/json",
          ...init.headers,
        },
      }),
    );
    const body: unknown = await response.json();
    if (!response.ok) throw new EvalHostClientError(response.status, body);
    return body;
  };
  return Object.freeze({
    manifest: async () => decodeEvalHostManifest(await request("manifest")),
    submit: async (job: SubmitEvalJobV1) =>
      decodeEvalHostJobStatus(
        await request("jobs", { method: "POST", body: JSON.stringify(job) }),
      ),
    poll: async (jobId: string) =>
      decodeEvalHostJobStatus(
        await request(`jobs/${encodeURIComponent(jobId)}`),
      ),
    cancel: async (jobId: string) =>
      decodeEvalHostJobStatus(
        await request(`jobs/${encodeURIComponent(jobId)}`, {
          method: "DELETE",
        }),
      ),
  });
}

/** Transport failure retaining the stable host error body for coordinators. */
export class EvalHostClientError extends Error {
  override readonly name = "EvalHostClientError";
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`Eval host request failed with HTTP ${status}.`);
  }
}

function trailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}
