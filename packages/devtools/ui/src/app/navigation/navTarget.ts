import type { NavState } from "@/app/navigation/useNavigation";
import type { DevtoolsViewId } from "../../devtools/shell/nav";

/**
 * Map a sidebar view id (issued by DevtoolsShell) to the canonical NavState.
 * Always lands on the list/index — drilldown state lives in URL params.
 */
export function navTarget(view: DevtoolsViewId): NavState {
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
 * Example: `run-detail` lives under Runs. Without this, opening a detail page would
 * leave no sidebar item marked active (the raw `nav.view` doesn't
 * equal any `DevtoolsViewId`). Detail screens are folded onto the same
 * targets. Returns `null` for views
 * with no owning sidebar item.
 */
export function sidebarIdForView(
  view: NavState["view"],
): DevtoolsViewId | null {
  switch (view) {
    case "overview":
      return "overview";
    case "insights":
      return "insights";
    case "runs":
    case "run-detail":
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
    case "prompt-preview":
    case "prompt-latest-run":
      return "library-index";
    case "library-memory":
      return "library-memory";
    case "library-workspaces":
      return "library-workspaces";
    case "library-plans":
      return "library-plans";
    default:
      return null;
  }
}

/**
 * Resolve a breadcrumb segment label — as authored in each page's
 * `breadcrumb="Group / Label / …"` string — to the nav target for that
 * screen's list/index. Group headings and detail ids aren't screens you can
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
