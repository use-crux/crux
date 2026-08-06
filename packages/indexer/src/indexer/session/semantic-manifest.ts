import type { CompletionSiteManifestEntry } from "../semantic/backends/tsgo/direct-projectors/completion-sites";

/** Session calls handled by the complete shared semantic analyzer. */
export const sessionSemanticCallNames = ["session", "getSession"] as const;

/** Structurally required completion role for Session Agent targets. */
export const sessionCompletionSites = [
  {
    callNames: sessionSemanticCallNames,
    propertyPath: ["$args", "0"],
    slot: "scalarIdentifier",
    acceptedKinds: ["agent"],
    insertion: "identifier",
  },
] as const satisfies readonly CompletionSiteManifestEntry[];
