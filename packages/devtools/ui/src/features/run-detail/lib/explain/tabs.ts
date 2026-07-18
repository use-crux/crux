/**
 * Deep-tab routing for the Run Detail `Explain` tab.
 *
 * Explain is a *read-out*: its rows summarise the turn and link into the
 * existing per-facet tabs (Context, Routing, Cache, …) rather than duplicating
 * their payloads. The report addresses those tabs with capitalised
 * {@link TurnDeepTabTarget} labels (`'Routing'`); the generation detail pane
 * keys its tabs by lowercase ids (`'routing'`). These helpers bridge the two
 * and respect which facet tabs are actually folded onto the current turn.
 */

import type { TurnDeepTabTarget } from "@/types";

/** The lowercase tab ids the generation detail pane switches between. */
export type ExplainGenTab =
  | "explain"
  | "output"
  | "context"
  | "routing"
  | "guardrail"
  | "security"
  | "constraint"
  | "cache"
  | "compaction"
  | (string & {});

/**
 * Map a report deep-tab label to the generation detail pane's tab id.
 *
 * Known labels get an explicit mapping; anything else is lowercased so a future
 * backend tab target still resolves to a plausible id instead of being dropped.
 */
export function deepTabToGenTab(tab: TurnDeepTabTarget["tab"]): ExplainGenTab {
  switch (tab) {
    case "Output":
      return "output";
    case "Context":
      return "context";
    case "Routing":
      return "routing";
    case "Guardrail":
      return "guardrail";
    case "Security":
      return "security";
    case "Constraint":
      return "constraint";
    case "Cache":
      return "cache";
    case "Compaction":
      return "compaction";
    default:
      return String(tab).toLowerCase();
  }
}

/**
 * Resolve a report deep-tab label to a tab id that is actually present on the
 * current turn, or `null` when there is nowhere to jump.
 *
 * Returning `null` lets the UI render the row without a dead "open" affordance —
 * honest about a facet whose deep evidence was not folded onto this generation.
 */
export function resolveOpenTab(
  tab: TurnDeepTabTarget["tab"] | undefined,
  availableTabs: readonly string[],
): ExplainGenTab | null {
  if (!tab) return null;
  const id = deepTabToGenTab(tab);
  return availableTabs.includes(id) ? id : null;
}
