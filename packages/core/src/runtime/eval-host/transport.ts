/** Extract a syntactically valid Eval job ID from the private route. */
export function jobIdFromPath(pathname: string): string | undefined {
  const match = /^\/jobs\/([A-Za-z0-9][A-Za-z0-9._:-]{0,127})$/.exec(pathname);
  return match?.[1];
}

/** Reject plaintext remote transport while preserving loopback development. */
export function isSecureRequest(request: Request): boolean {
  const url = new URL(request.url);
  return (
    url.protocol === "https:" ||
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1"
  );
}

/** Apply the bounded process-local poll window used by the reference host. */
export function admitPoll(
  windows: Map<string, { second: number; count: number }>,
  jobId: string,
  now: Date,
  limit: number,
): boolean {
  const second = Math.floor(now.getTime() / 1_000);
  const current = windows.get(jobId);
  const next = current?.second === second ? current.count + 1 : 1;
  windows.set(jobId, { second, count: next });
  return next <= limit;
}

/** Encode one exact JSON response without enabling browser CORS. */
export function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function unauthorizedError() {
  return {
    code: "EVAL_HOST_UNAUTHORIZED",
    message: "A valid Eval-execute bearer capability is required.",
    retryable: false,
    phase: "auth",
  } as const;
}

export function routeError() {
  return {
    code: "EVAL_HOST_ROUTE_NOT_FOUND",
    message: "The requested Eval host route does not exist.",
    retryable: false,
    phase: "transport",
  } as const;
}

export function pollRateError() {
  return {
    code: "EVAL_HOST_POLL_RATE_LIMIT",
    message: "The Eval job poll rate limit was exceeded.",
    retryable: false,
    phase: "transport",
  } as const;
}

export function insecureTransportError() {
  return {
    code: "EVAL_HOST_HTTPS_REQUIRED",
    message: "Eval host requests require HTTPS outside loopback.",
    retryable: false,
    phase: "transport",
  } as const;
}
