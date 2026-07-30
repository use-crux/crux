import type { NavState } from "./navigation-state";

/** Encode one navigation state into its canonical Devtools path. */
export function pathFromState(state: NavState): string {
  switch (state.view) {
    case "overview":
      return "/";
    case "insights": {
      if (state.insightId)
        return `/insights/${encodeURIComponent(state.insightId)}`;
      const params = new URLSearchParams();
      if (state.severity?.length) params.set("sev", state.severity.join(","));
      if (state.target?.length) params.set("target", state.target.join(","));
      if (state.status?.length) params.set("status", state.status.join(","));
      if (state.title?.length) params.set("title", state.title.join("|"));
      if (state.tag?.length) params.set("tag", state.tag.join(","));
      if (state.groupBy && state.groupBy !== "none")
        params.set("group", state.groupBy);
      if (state.search) params.set("q", state.search);
      return withQuery("/insights", params);
    }
    case "runs": {
      const params = new URLSearchParams();
      if (state.groupBy && state.groupBy !== "none")
        params.set("group", state.groupBy);
      if (state.status?.length) params.set("status", state.status.join(","));
      if (state.target?.length) params.set("target", state.target.join(","));
      if (state.model?.length) params.set("model", state.model.join(","));
      if (state.last && state.last !== "all") params.set("last", state.last);
      if (state.search) params.set("q", state.search);
      if (state.definitionId) params.set("definitionId", state.definitionId);
      return withQuery("/runs", params);
    }
    case "runtime":
      return "/runtime";
    case "run-detail": {
      const params = new URLSearchParams();
      if (state.lens && state.lens !== "tree") params.set("lens", state.lens);
      if (state.summary) params.set("summary", "1");
      if (state.spanId) params.set("spanId", state.spanId);
      if (state.detailTab === "evidence") {
        params.set("tab", "evidence");
        if (state.evidenceRole)
          params.set("evidenceRole", state.evidenceRole);
        if (state.evidenceId) params.set("evidenceId", state.evidenceId);
      }
      return withQuery(`/runs/${encodeURIComponent(state.traceId)}`, params);
    }
    case "baselines":
      return "/baselines";
    case "eval-runs":
      return optionalIdPath("/eval-runs", state.runId);
    case "review":
      return optionalIdPath("/review", state.reviewId);
    case "library-index":
      if (
        state.tab === "health" &&
        !state.promptId &&
        !state.contextId &&
        !state.toolName
      )
        return "/library/index/health";
      if (state.toolName)
        return `/library/index/tool/${encodeURIComponent(state.toolName)}`;
      if (state.contextId)
        return `/library/index/context/${encodeURIComponent(state.contextId)}`;
      if (state.promptId && state.tab)
        return `/library/index/${encodeURIComponent(state.promptId)}/${encodeURIComponent(state.tab)}`;
      return optionalIdPath("/library/index", state.promptId);
    case "prompt-preview":
      return `/library/index/prompt/${encodeURIComponent(state.definitionId)}/preview`;
    case "prompt-latest-run":
      return `/library/index/prompt/${encodeURIComponent(state.definitionId)}/latest-run`;
    case "library-memory":
      return optionalIdPath("/library/memory", state.memoryId);
    case "library-workspaces":
      if (!state.workspaceId) return "/library/workspaces";
      return `/library/workspaces/${encodeURIComponent(state.workspaceId)}${
        state.filePath ? `/${encodeURIComponent(state.filePath)}` : ""
      }`;
    case "library-plans":
      return optionalIdPath("/library/plans", state.planId);
    case "evals":
      return optionalIdPath("/evals", state.evalId);
  }
}

function withQuery(path: string, params: URLSearchParams): string {
  const query = params.toString();
  return `${path}${query ? `?${query}` : ""}`;
}

function optionalIdPath(path: string, id: string | undefined): string {
  return id ? `${path}/${encodeURIComponent(id)}` : path;
}
