/**
 * Canonical primitive → family → tone resolver.
 *
 * The single source of truth for how a span's `primitive` maps to a colour
 * family and a kind-tag label. Ports the v2 Run Detail design system's
 * "Primitive families & kind tags" + §8 consistency pass: nine families, each
 * owning one tone, keyed off the *full* primitive string (never a coarse
 * sibling kind). Every tree / timeline / graph / card / replay colour and every
 * `KindTag` derives from here, so adding a primitive is a one-line change and
 * the surfaces can't drift apart again.
 *
 *   Orchestration → crux   composition.* · flow.*
 *   Agents        → iris   agent.* · delegate.*
 *   Generation    → warn   generation.* · compaction.*
 *   Capabilities  → ok/—   retrieval.*·knowledge.*·embedding.* (ok) · tool.*·cache.* (neutral)
 *   State         → plum   memory.* · thread.* · plan.* · blackboard.* · operation · corpus/indexing/ingest.*
 *   Routing       → warn   routing.* · fallback.* · tool.approval
 *   Safety        → danger guardrail.* · constraint.* · security.*
 *   Evaluation    → gold   eval.* · scoring.*
 *   Transition    → faint  handoff.* · transition.*  (render as edges, neutral tone)
 */

import type { ChipTone } from "@/devtools/shell/primitives";

/** Chip/family tone token → CSS custom property. Single source of truth. */
export const TONE_VAR: Record<ChipTone, string> = {
  muted: "var(--devtools-fg-muted)",
  crux: "var(--devtools-crux)",
  danger: "var(--devtools-danger)",
  warn: "var(--devtools-warn)",
  ok: "var(--devtools-ok)",
  iris: "var(--devtools-iris)",
  gold: "var(--devtools-gold)",
  plum: "var(--devtools-plum)",
};

export type PrimitiveFamily =
  | "orchestration"
  | "agents"
  | "generation"
  | "capabilities"
  | "state"
  | "routing"
  | "safety"
  | "evaluation"
  | "transition"
  | "unknown";

function hasPrefix(p: string, prefixes: readonly string[]): boolean {
  return prefixes.some((x) => p === x || p.startsWith(x));
}

/** Resolve a primitive string to its design family. Order matters: the more
 *  specific overrides (tool.approval → routing) are checked before the broad
 *  capability buckets. */
export function primitiveFamily(
  primitive: string | undefined,
): PrimitiveFamily {
  const p = (primitive ?? "").toLowerCase();
  if (!p) return "unknown";
  // The run root is the outermost composite — read it in the Orchestration tone.
  if (p === "run") return "orchestration";
  if (hasPrefix(p, ["guardrail.", "constraint.", "security."])) return "safety";
  if (hasPrefix(p, ["eval.", "scoring."])) return "evaluation";
  // A gated tool approval is a Routing concern, not a capability call.
  if (p === "tool.approval" || p.startsWith("approval")) return "routing";
  if (hasPrefix(p, ["routing.", "fallback."])) return "routing";
  if (hasPrefix(p, ["agent.", "delegate."])) return "agents";
  if (hasPrefix(p, ["composition.", "flow", "defer."])) return "orchestration";
  if (p === "defer") return "orchestration";
  if (hasPrefix(p, ["generation.", "compaction."])) return "generation";
  // Multimodal completed operations read as generation-adjacent (warn tone).
  if (hasPrefix(p, ["media."])) return "generation";
  if (
    hasPrefix(p, [
      "retrieval.",
      "knowledge.",
      "embedding.",
      "tool.",
      "cache.",
      "mcp.",
    ])
  )
    return "capabilities";
  if (
    p === "operation" ||
    hasPrefix(p, [
      "memory.",
      "thread.",
      "plan.",
      "blackboard.",
      "operation.",
      "corpus.",
      "indexing.",
      "ingest.",
    ])
  )
    return "state";
  if (hasPrefix(p, ["handoff.", "transition"])) return "transition";
  return "unknown";
}

/** The family tone for a primitive. Capabilities split: retrieval/embedding read
 *  `ok` (green), tool/cache read neutral. Transition keeps a neutral tone but a
 *  faint accent (see {@link primitiveAccentVar}). */
export function primitiveTone(primitive: string | undefined): ChipTone {
  const p = (primitive ?? "").toLowerCase();
  switch (primitiveFamily(p)) {
    case "orchestration":
      return "crux";
    case "agents":
      return "iris";
    case "generation":
      return "warn";
    case "routing":
      return "warn";
    case "safety":
      return "danger";
    case "evaluation":
      return "gold";
    case "state":
      return "plum";
    case "capabilities":
      return hasPrefix(p, ["retrieval.", "knowledge.", "embedding."])
        ? "ok"
        : "muted";
    case "transition":
    default:
      return "muted";
  }
}

/** The CSS accent colour for a primitive — what tree rows, graph nodes and card
 *  rails tint with. Transition resolves to the faint token (edges, not nodes). */
export function primitiveAccentVar(primitive: string | undefined): string {
  if (primitiveFamily(primitive) === "transition") return "var(--devtools-fg-faint)";
  return TONE_VAR[primitiveTone(primitive)];
}

/** Curated short label a kind tag shows — names the primitive it sits on (v2 §5
 *  "Tag" column). First segment by default, with the documented exceptions where
 *  the meaningful word is the second segment. */
const TAG_LABEL_OVERRIDES: Record<string, string> = {
  "composition.pipeline": "pipeline",
  "composition.parallel": "parallel",
  "composition.consensus": "consensus",
  "tool.approval": "approval",
  "defer.scheduled": "scheduled",
  "defer.run": "deferred",
};

export function primitiveTagLabel(primitive: string | undefined): string {
  const p = (primitive ?? "").toLowerCase();
  if (!p) return "";
  if (TAG_LABEL_OVERRIDES[p]) return TAG_LABEL_OVERRIDES[p];
  if (hasPrefix(p, ["corpus.", "indexing.", "ingest."])) return "operation";
  return p.split(".")[0] ?? p;
}
