/**
 * Local HTTP adapter for the canonical readable evidence destination.
 *
 * @internal
 * @module
 */

import type {
  CruxEvidenceQueryDestination,
  EvidenceDestinationInspectRequest,
  EvidenceDestinationInspectResult,
} from "../evidence/destination";

interface HttpEvidenceDestinationOptions {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly fetchImpl: typeof globalThis.fetch | undefined;
}

/** Construct one fail-closed Local evidence query capability. */
export function createHttpEvidenceDestination(
  options: HttpEvidenceDestinationOptions,
): CruxEvidenceQueryDestination {
  return {
    async inspectEvidence(
      request: EvidenceDestinationInspectRequest,
    ): Promise<EvidenceDestinationInspectResult> {
      if (!options.fetchImpl) {
        throw new Error("Evidence inspection request failed");
      }
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        options.timeoutMs,
      );
      try {
        const response = await options.fetchImpl(options.url, {
          method: "POST",
          headers: options.headers,
          body: JSON.stringify(request),
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error("Evidence inspection request failed");
        }
        const decoded: unknown = JSON.parse(await response.text());
        if (
          decoded === null ||
          typeof decoded !== "object" ||
          Array.isArray(decoded)
        ) {
          throw new Error("Evidence inspection request failed");
        }
        return decoded as EvidenceDestinationInspectResult;
      } catch {
        throw new Error("Evidence inspection request failed");
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
