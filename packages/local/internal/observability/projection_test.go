package observability

import (
	"testing"
	"time"
)

func TestProjectRunDetailUsesExplicitProjectionClock(t *testing.T) {
	started := time.Date(2026, 5, 24, 10, 0, 0, 0, time.UTC)
	graph := Graph{
		Run: RunSummary{
			RunID:         "run_clock",
			TraceID:       "trace_clock",
			Name:          "clocked run",
			RootPrimitive: "agent.run",
			Status:        "running",
			StartedAt:     started.Format(time.RFC3339Nano),
		},
		Spans: []SpanSummary{{
			RunID:     "run_clock",
			TraceID:   "trace_clock",
			SpanID:    "span_agent",
			Family:    "agent",
			Primitive: "agent.run",
			Name:      "clocked run",
			Status:    "running",
			StartedAt: started.Format(time.RFC3339Nano),
		}},
	}

	active := ProjectRunDetail(graph, ProjectionOptions{Now: started.Add(10 * time.Second)})
	if active.Run.Status != "running" || active.Root.Status != "running" {
		t.Fatalf("active statuses = %q/%q, want running/running", active.Run.Status, active.Root.Status)
	}

	stale := ProjectRunDetail(graph, ProjectionOptions{Now: started.Add(time.Minute)})
	if stale.Run.Status != "stale" || stale.Root.Status != "stale" {
		t.Fatalf("stale statuses = %q/%q, want stale/stale", stale.Run.Status, stale.Root.Status)
	}
	if stale.Run.DurationMs != 60000 || stale.Root.DurationMs != 60000 {
		t.Fatalf("stale durations = %f/%f, want 60000/60000", stale.Run.DurationMs, stale.Root.DurationMs)
	}
}
