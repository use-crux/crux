/**
 * Readable request-inspection capability on an observability destination.
 *
 * @module
 */

/** Retained request-inspection reader owned by the canonical destination. */
export interface CruxRequestInspectionDestination {
  /** Read one redacted inspection by its public request identity. */
  inspectRequest(id: string): Promise<unknown>;
}

interface HttpRequestInspectionDestinationOptions {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly fetchImpl: typeof globalThis.fetch | undefined;
}

/** Construct the Local HTTP request-inspection reader. @internal */
export function createHttpRequestInspectionDestination(
  options: HttpRequestInspectionDestinationOptions,
): CruxRequestInspectionDestination {
  return {
    async inspectRequest(id) {
      if (!options.fetchImpl) throw new Error("Request inspection failed");
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
      try {
        const response = await options.fetchImpl(options.url, {
          method: "POST",
          headers: options.headers,
          body: JSON.stringify({ id }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Request inspection failed");
        return JSON.parse(await response.text()) as unknown;
      } catch {
        throw new Error("Request inspection failed");
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
