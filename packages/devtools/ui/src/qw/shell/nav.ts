/**
 * Devtools navigation map for inspection, Evals, and the Project Index.
 */

export type QwViewId =
  | "overview"
  | "insights"
  | "runs"
  | "runtime"
  | "evals"
  | "eval-runs"
  | "review"
  | "baselines"
  | "library-index"
  | "library-memory"
  | "library-workspaces"
  | "library-plans";

export interface QwNavItem {
  id: QwViewId;
  label: string;
  iconName: IconName;
}

export interface QwNavGroup {
  id: string;
  label: string;
  items: QwNavItem[];
}

export type IconName =
  | "home"
  | "sparkle"
  | "trace"
  | "layers"
  | "flask"
  | "compare"
  | "bookmark"
  | "inbox"
  | "cassette"
  | "filter"
  | "search"
  | "play"
  | "arrowRight"
  | "arrowDown"
  | "arrowUp"
  | "check"
  | "x"
  | "loop"
  | "spark"
  | "alert"
  | "diff"
  | "more"
  | "book"
  | "brain"
  | "folder"
  | "list"
  | "tasks"
  | "doc"
  | "link"
  | "db"
  | "grid"
  | "clock"
  | "user"
  | "branch"
  | "bot"
  | "info";

export const QW_NAV: QwNavGroup[] = [
  {
    id: "inspect",
    label: "Inspect",
    items: [
      { id: "overview", label: "Overview", iconName: "home" },
      { id: "insights", label: "Insights", iconName: "sparkle" },
      { id: "runs", label: "Runs", iconName: "trace" },
      { id: "runtime", label: "Runtime", iconName: "db" },
    ],
  },
  {
    id: "evaluate",
    label: "Evals",
    items: [
      { id: "evals", label: "Evals", iconName: "layers" },
      { id: "eval-runs", label: "Eval runs", iconName: "flask" },
      { id: "baselines", label: "Baselines", iconName: "bookmark" },
      { id: "review", label: "Review", iconName: "inbox" },
    ],
  },
  {
    id: "library",
    label: "Library",
    items: [
      { id: "library-index", label: "Index", iconName: "book" },
      { id: "library-memory", label: "Memory", iconName: "brain" },
      { id: "library-workspaces", label: "Workspaces", iconName: "folder" },
      { id: "library-plans", label: "Plans & Tasks", iconName: "tasks" },
    ],
  },
];
