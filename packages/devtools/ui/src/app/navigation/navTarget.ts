import type { NavState } from "@/app/navigation/useNavigation";
import type { QwViewId } from "../../qw/shell/nav";

/**
 * Map a sidebar view id (issued by QwShell) to the canonical NavState.
 * Always lands on the list/index — drilldown state lives in URL params.
 */
export function navTarget(view: QwViewId): NavState {
  switch (view) {
    case "overview":
      return { view: "overview" };
    case "insights":
      return { view: "insights" };
    case "runs":
      return { view: "runs" };
    case "runtime":
      return { view: "runtime" };
    case "baselines":
      return { view: "baselines" };
    case "evals":
      return { view: "evals" };
    case "eval-runs":
      return { view: "eval-runs" };
    case "review":
      return { view: "review" };
    case "library-index":
      return { view: "library-index" };
    case "library-memory":
      return { view: "library-memory" };
    case "library-workspaces":
      return { view: "library-workspaces" };
    case "library-plans":
      return { view: "library-plans" };
  }
}

/**
 * Map any NavState view to the sidebar item that "owns" it, so that
 * detail/drilldown screens keep their parent menu item highlighted.
 *
 * Example: `experiment-detail` lives under the Experiments menu item,
 * `run-detail` under Runs. Without this, opening a detail page would
 * leave no sidebar item marked active (the raw `nav.view` doesn't
 * equal any `QwViewId`). Legacy view aliases are folded onto the same
 * targets they coerce to in `pathFromState`. Returns `null` for views
 * with no owning sidebar item.
 */
export function sidebarIdForView(view: NavState["view"]): QwViewId | null {
  switch (view) {
    case "overview":
    case "dashboard":
      return "overview";
    case "insights":
    case "security":
      return "insights";
    case "runs":
    case "run-detail":
    case "traces":
    case "detail":
    case "sessions":
    case "constraints":
      return "runs";
    case "runtime":
      return "runtime";
    case "evals":
      return "evals";
    case "eval-runs":
      return "eval-runs";
    case "review":
      return "review";
    case "baselines":
      return "baselines";
    case "library-index":
    case "prompts":
      return "library-index";
    case "library-memory":
    case "memory":
      return "library-memory";
    case "library-workspaces":
    case "workspaces":
      return "library-workspaces";
    case "library-plans":
    case "plans":
      return "library-plans";
    default:
      return null;
  }
}

/**
 * Resolve a breadcrumb segment label — as authored in each page's
 * `breadcrumb="Group / Label / …"` string — to the nav target for that
 * screen's list/index. Group headings (Inspect, Evaluate, Loop,
 * Library, Settings, Quality) and detail ids aren't screens you can
 * land on, so they return `null` and render as plain text.
 */
export function breadcrumbTarget(label: string): NavState | null {
  switch (label) {
    case "Overview":
      return { view: "overview" };
    case "Insights":
      return { view: "insights" };
    case "Runs":
      return { view: "runs" };
    case "Runtime":
      return { view: "runtime" };
    case "Baselines":
      return { view: "baselines" };
    case "Evals":
      return { view: "evals" };
    case "Eval runs":
      return { view: "eval-runs" };
    case "Review":
      return { view: "review" };
    case "Index":
      return { view: "library-index" };
    case "Memory":
      return { view: "library-memory" };
    case "Workspaces":
      return { view: "library-workspaces" };
    case "Plans":
      return { view: "library-plans" };
    default:
      return null;
  }
}
