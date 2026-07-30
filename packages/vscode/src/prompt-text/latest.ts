import type { Utf16Position } from "./contracts.js";
import {
  parsePromptTextLatestRunLinkResult,
  promptTextOpenLatestRunLinkMethod,
  promptTextOpenLatestRunLinkParams,
  validatedPromptTextLatestRunUrl,
} from "./latest-link.js";
import type { PromptTextPreviewSource } from "./preview/types.js";

/** Minimal request port used by the functional latest-Run operation. */
export interface PromptTextLatestRunClient {
  sendRequest(method: string, params: unknown): Promise<unknown>;
}

/** Process and editor ports required to validate and open one latest Run. */
export interface PromptTextLatestRunHost {
  readonly client: () => PromptTextLatestRunClient | undefined;
  readonly currentSource: (uri: string) => PromptTextPreviewSource | undefined;
  readonly configuredPort: () => number;
  readonly openExternal: (url: string) => Promise<void>;
  readonly showInformation: (message: string) => void;
}

/**
 * Request and open one click-time latest-Run resolver without retaining state.
 *
 * Client replacement or any current document-stamp change silently retires the
 * result before URL validation and external navigation.
 */
export async function openPromptTextLatestRun(
  host: PromptTextLatestRunHost,
  source: PromptTextPreviewSource,
  position: Utf16Position,
): Promise<void> {
  const client = host.client();
  if (client === undefined) {
    host.showInformation(
      "Current semantic PromptText analysis is unavailable.",
    );
    return;
  }
  let value: unknown;
  try {
    value = await client.sendRequest(
      promptTextOpenLatestRunLinkMethod,
      promptTextOpenLatestRunLinkParams(source, position),
    );
  } catch {
    if (host.client() === client) {
      host.showInformation(
        "Current semantic PromptText analysis is unavailable.",
      );
    }
    return;
  }
  if (host.client() !== client) return;
  const current = host.currentSource(source.uri);
  if (
    current === undefined ||
    current.uri !== source.uri ||
    current.openEpoch !== source.openEpoch ||
    current.version !== source.version ||
    current.sourceHash !== source.sourceHash
  ) {
    return;
  }
  const result = parsePromptTextLatestRunLinkResult(value);
  if (result === undefined) {
    host.showInformation(
      "Current semantic PromptText analysis is unavailable.",
    );
    return;
  }
  if (result.kind !== "ready") {
    host.showInformation(result.message);
    return;
  }
  const url = validatedPromptTextLatestRunUrl(
    result.url,
    host.configuredPort(),
  );
  if (url === undefined) {
    host.showInformation("Crux rejected an unsafe latest-Run URL.");
    return;
  }
  await host.openExternal(url);
}
