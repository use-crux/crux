import type { AnyPrompt } from "../prompt/prompt-types";
import type { PromptPreviewTarget } from "../runtime-bridge/prompt-preview/protocol";

/** Runtime callback and bounded wire identity captured in one publication. */
export interface ActivePromptCatalogueEntry {
  readonly prompt: AnyPrompt;
  readonly target: PromptPreviewTarget;
}

/** Immutable snapshot shared by HTTP and WebSocket bridge transports. */
export interface ActivePromptCatalogue {
  /** Positive for every publication; zero means no public publication yet. */
  readonly revision: number;
  readonly entries: readonly ActivePromptCatalogueEntry[];
}

/** Listener notified after an atomic catalogue replacement or retirement. */
export type PromptCatalogueListener = (
  catalogue: ActivePromptCatalogue,
) => void;

/** Validate the process-global catalogue slot owned by this Core version. */
export function isActivePromptCatalogue(
  value: unknown,
): value is ActivePromptCatalogue {
  if (typeof value !== "object" || value === null) return false;
  const catalogue = value as Partial<ActivePromptCatalogue>;
  return (
    Number.isSafeInteger(catalogue.revision) &&
    (catalogue.revision as number) >= 0 &&
    Array.isArray(catalogue.entries) &&
    catalogue.entries.every(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as { prompt?: unknown }).prompt === "object" &&
        typeof (entry as { target?: unknown }).target === "object",
    )
  );
}
