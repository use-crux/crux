import type { RunLens } from "@/features/run-detail/types";
import type { EvidenceRole } from "@use-crux/core/evidence";

/** Complete URL-backed state for one Devtools screen. */
export type NavState =
  | { view: "overview" }
  | {
      view: "insights";
      insightId?: string;
      severity?: readonly ("high" | "medium" | "low")[];
      target?: readonly string[];
      status?: readonly ("open" | "dismissed" | "resolved")[];
      /** Insight title stamped consistently by the server. */
      title?: readonly string[];
      /** Insight tag such as Latency or Cost. */
      tag?: readonly string[];
      groupBy?: "none" | "severity" | "target" | "status" | "title" | "tag";
      search?: string;
    }
  | {
      view: "runs";
      groupBy?: "none" | "primitive" | "session" | "target";
      status?: readonly string[];
      target?: readonly string[];
      model?: readonly string[];
      last?: "all" | "1h" | "24h" | "7d" | "30d";
      search?: string;
      /** Restrict Runs to this Project Index definition. */
      definitionId?: string;
    }
  | { view: "runtime" }
  | {
      view: "run-detail";
      traceId: string;
      lens?: RunLens;
      spanId?: string;
      summary?: boolean;
      detailTab?: "evidence";
      evidenceRole?: EvidenceRole;
      evidenceId?: string;
    }
  | { view: "baselines" }
  | { view: "eval-runs"; runId?: string }
  | { view: "review"; reviewId?: string }
  | {
      view: "library-index";
      promptId?: string;
      contextId?: string;
      toolName?: string;
      tab?: string;
    }
  | { view: "prompt-preview"; definitionId: string }
  | { view: "prompt-latest-run"; definitionId: string }
  | { view: "library-memory"; memoryId?: string }
  | { view: "library-workspaces"; workspaceId?: string; filePath?: string }
  | { view: "library-plans"; planId?: string }
  | { view: "evals"; evalId?: string };
