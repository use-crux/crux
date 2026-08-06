package uitest

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
)

func TestFixtureClientObservabilityRunDetail(t *testing.T) {
	client := NewFixtureClient()
	detail, found, err := client.ObservabilityRunDetail(nil, "8af2f1c")
	if err != nil {
		t.Fatalf("ObservabilityRunDetail returned error: %v", err)
	}
	if !found {
		t.Fatal("ObservabilityRunDetail did not find fixture trace 8af2f1c")
	}
	var nodes int
	var visit func(api.ObservabilityRunDetailNode)
	visit = func(node api.ObservabilityRunDetailNode) {
		nodes++
		for _, child := range node.Children {
			visit(child)
		}
	}
	visit(detail.Root)
	if nodes < 8 {
		t.Fatalf("ObservabilityRunDetail nodes = %d, want a mockup-shaped trace", nodes)
	}
	if detail.Root.SpanID != "root" || len(detail.Root.Children) != 4 {
		t.Fatalf("ObservabilityRunDetail root = %#v, want nested production shape", detail.Root)
	}
	if detail.Run.SpanCount != nodes {
		t.Fatalf("ObservabilityRunDetail spanCount = %d, nodes = %d", detail.Run.SpanCount, nodes)
	}
}

func TestFixtureClientIndexDepthJoins(t *testing.T) {
	client := NewFixtureClient()
	activity, err := client.DefinitionActivity(context.Background(), "prompt:writer.prompt")
	if err != nil {
		t.Fatalf("DefinitionActivity returned error: %v", err)
	}
	if activity.RunCount != 3 || activity.LastRunID != "8af2f1c" || activity.LastStatus != "failed" {
		t.Fatalf("DefinitionActivity = %+v, want populated fixture join", activity)
	}
	status, err := client.ProjectIndexWatchStatus(context.Background())
	if err != nil {
		t.Fatalf("ProjectIndexWatchStatus returned error: %v", err)
	}
	if status.State != "idle" {
		t.Fatalf("ProjectIndexWatchStatus = %+v, want idle", status)
	}
}

func TestFixtureClientSessionsAndRunFilters(t *testing.T) {
	client := NewFixtureClient()
	sessions, err := client.Sessions(context.Background())
	if err != nil {
		t.Fatalf("Sessions returned error: %v", err)
	}
	if len(sessions) != 1 || sessions[0].SessionID != "session_docs" || sessions[0].TraceCount != 1 {
		t.Fatalf("Sessions = %+v, want session_docs", sessions)
	}
	runs, err := client.RunsWithOptions(context.Background(), api.InspectRunsOptions{
		Session: []string{"session_docs"},
		Status:  []string{"failed"},
		Model:   []string{"gpt-5"},
		Since:   client.Now.Add(-time.Hour).UnixMilli(),
	})
	if err != nil {
		t.Fatalf("RunsWithOptions returned error: %v", err)
	}
	if len(runs) != 1 || runs[0].OperationID != "8af2f1c" {
		t.Fatalf("filtered runs = %+v, want fixture run", runs)
	}
}

func TestFixtureClientStatsAndTimeseries(t *testing.T) {
	client := NewFixtureClient()
	stats, err := client.Stats(context.Background())
	if err != nil {
		t.Fatalf("Stats returned error: %v", err)
	}
	if stats.TotalExecutions != 42 || stats.TotalCost != 1.0122 || stats.AvgCost != 0.0241 {
		t.Fatalf("Stats = %+v, want non-trivial aggregate fixture", stats)
	}
	series, err := client.StatsTimeseries(context.Background(), 4)
	if err != nil {
		t.Fatalf("StatsTimeseries returned error: %v", err)
	}
	if len(series) != 4 || series[0].Executions == series[len(series)-1].Executions ||
		series[0].TotalCost == series[len(series)-1].TotalCost ||
		series[0].AvgDurationMs == series[len(series)-1].AvgDurationMs {
		t.Fatalf("StatsTimeseries = %+v, want bounded non-trivial series", series)
	}
}

func TestFixtureClientEvalReads(t *testing.T) {
	client := NewFixtureClient()
	catalog, err := client.EvalCatalog(context.Background())
	if err != nil || len(catalog) != 1 {
		t.Fatalf("EvalCatalog = %s, err = %v", catalog, err)
	}
	var manifest struct {
		ID            string   `json:"id"`
		Cases         []any    `json:"cases"`
		Variants      []string `json:"variants"`
		HostReadiness struct {
			Status   string   `json:"status"`
			Remedies []string `json:"remedies"`
		} `json:"hostReadiness"`
		SourceKey struct {
			RelativeFile string `json:"relativeFile"`
		} `json:"sourceKey"`
	}
	if err := json.Unmarshal(catalog[0], &manifest); err != nil {
		t.Fatalf("EvalCatalog JSON: %v", err)
	}
	if manifest.ID != "demo.support-quality" || len(manifest.Cases) != 3 ||
		len(manifest.Variants) != 2 || manifest.HostReadiness.Status != "setup-required" ||
		len(manifest.HostReadiness.Remedies) == 0 || manifest.SourceKey.RelativeFile != "evals/support.eval.ts" {
		t.Fatalf("EvalCatalog manifest = %+v, want complete fixture catalog data", manifest)
	}

	runs, err := client.EvalRuns(context.Background())
	if err != nil || len(runs) != 1 {
		t.Fatalf("EvalRuns = %s, err = %v", runs, err)
	}
	var run struct {
		RunID string `json:"runId"`
		Cells []struct {
			Status string `json:"status"`
			Task   struct {
				Status string `json:"status"`
				Reason string `json:"reason"`
			} `json:"task"`
		} `json:"cells"`
	}
	if err := json.Unmarshal(runs[0], &run); err != nil {
		t.Fatalf("EvalRuns JSON: %v", err)
	}
	statuses := map[string]bool{}
	reused := false
	for _, cell := range run.Cells {
		statuses[cell.Status] = true
		reused = reused || (cell.Task.Status == "reused" && cell.Task.Reason == "exact_evidence")
	}
	if run.RunID != fixtureEvalRunID || len(run.Cells) != 6 ||
		!statuses["passed"] || !statuses["failed"] || !statuses["skipped"] || !reused {
		t.Fatalf("Eval run = %+v, want 3x2 mixed matrix with reuse", run)
	}
	detail, err := client.EvalRun(context.Background(), fixtureEvalRunID)
	if err != nil || string(detail) != string(runs[0]) {
		t.Fatalf("EvalRun = %s, err = %v", detail, err)
	}

	baselines, err := client.EvalBaselines(context.Background())
	if err != nil || len(baselines) != 1 {
		t.Fatalf("EvalBaselines = %s, err = %v", baselines, err)
	}
	var baseline struct {
		RunID         string `json:"runId"`
		SelectedArm   string `json:"selectedArm"`
		Compatibility struct {
			Status string `json:"status"`
			Cases  []struct {
				Status string `json:"status"`
			} `json:"cases"`
		} `json:"baselineCompatibility"`
	}
	if err := json.Unmarshal(baselines[0], &baseline); err != nil {
		t.Fatalf("EvalBaselines JSON: %v", err)
	}
	incompatible := 0
	for _, item := range baseline.Compatibility.Cases {
		if item.Status == "incompatible" {
			incompatible++
		}
	}
	if baseline.RunID != fixtureEvalBaselineRunID || baseline.RunID == run.RunID ||
		baseline.SelectedArm != "current" || baseline.Compatibility.Status != "incompatible" || incompatible != 1 {
		t.Fatalf("Eval baseline = %+v, want older baseline run and one incompatible case", baseline)
	}
}
