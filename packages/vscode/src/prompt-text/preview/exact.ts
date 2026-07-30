import type { Utf16Position } from "../contracts.js";
import {
  parsePromptTextPreviewExactLinkResult,
  promptTextPreviewExactLinkMethod,
  promptTextPreviewExactLinkParams,
  validatedPromptTextExactPreviewUrl,
} from "../exact-link.js";
import type { PromptTextPreviewSource } from "./types.js";

/** Minimal request port used by the functional exact-preview operation. */
export interface PromptTextExactPreviewClient {
  sendRequest(method: string, params: unknown): Promise<unknown>;
}

/** Process and editor ports required to validate and open one exact preview. */
export interface PromptTextExactPreviewHost {
  readonly client: () => PromptTextExactPreviewClient | undefined;
  readonly currentSource: (uri: string) => PromptTextPreviewSource | undefined;
  readonly configuredPort: () => number;
  readonly openExternal: (url: string) => Promise<void>;
  readonly showInformation: (message: string) => void;
}

/**
 * Request and open one exact Prompt preview without retaining editor state.
 *
 * Source or client changes silently retire the result. The stateful VS Code
 * controller owns those lifecycles; this operation only validates one pull.
 */
export async function openPromptTextExactPreview(
  host: PromptTextExactPreviewHost,
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
      promptTextPreviewExactLinkMethod,
      promptTextPreviewExactLinkParams(source, position),
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
    current.openEpoch !== source.openEpoch ||
    current.version !== source.version ||
    current.sourceHash !== source.sourceHash
  ) {
    return;
  }
  const result = parsePromptTextPreviewExactLinkResult(value);
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
  const url = validatedPromptTextExactPreviewUrl(
    result.url,
    host.configuredPort(),
  );
  if (url === undefined) {
    host.showInformation("Crux rejected an unsafe exact-preview URL.");
    return;
  }
  await host.openExternal(url);
}
