package observability

import (
	"encoding/json"
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

func TestProjectRunDetailUsesConvexBoundaryLeaseAsActiveWork(t *testing.T) {
	started := time.Date(2026, 5, 24, 10, 0, 0, 0, time.UTC)
	leaseExpiresAt := started.Add(11 * time.Minute)
	graph := Graph{
		Run: RunSummary{
			RunID:         "run_boundary_lease_active",
			TraceID:       "trace_boundary_lease_active",
			Name:          "Karyla",
			RootPrimitive: "agent.run",
			Status:        "running",
			StartedAt:     started.Format(time.RFC3339Nano),
		},
		Spans: []SpanSummary{
			{
				RunID:     "run_boundary_lease_active",
				TraceID:   "trace_boundary_lease_active",
				SpanID:    "span_agent",
				Family:    "agent",
				Primitive: "agent.run",
				Name:      "Karyla",
				Status:    "running",
				StartedAt: started.Format(time.RFC3339Nano),
			},
			{
				RunID:        "run_boundary_lease_active",
				TraceID:      "trace_boundary_lease_active",
				SpanID:       "span_boundary",
				ParentSpanID: "span_agent",
				Family:       "runtime",
				Primitive:    "runtime.convex.action",
				Name:         "research",
				Status:       "running",
				StartedAt:    started.Add(time.Second).Format(time.RFC3339Nano),
			},
		},
		Events: []SpanEventSummary{{
			RunID:     "run_boundary_lease_active",
			TraceID:   "trace_boundary_lease_active",
			SpanID:    "span_boundary",
			Name:      "runtime.convex.boundary.requested",
			Timestamp: started.Add(time.Second).Format(time.RFC3339Nano),
			Attributes: json.RawMessage(
				`{"leaseExpiresAt":"` + leaseExpiresAt.Format(time.RFC3339Nano) + `"}`,
			),
		}},
	}

	active := ProjectRunDetail(graph, ProjectionOptions{Now: started.Add(2 * time.Minute)})
	if active.Run.Status != "running" || active.Root.Status != "running" {
		t.Fatalf("active statuses = %q/%q, want running/running", active.Run.Status, active.Root.Status)
	}

	expired := ProjectRunDetail(graph, ProjectionOptions{Now: leaseExpiresAt.Add(time.Second)})
	if expired.Run.Status != "stale" || expired.Root.Status != "stale" {
		t.Fatalf("expired statuses = %q/%q, want stale/stale", expired.Run.Status, expired.Root.Status)
	}
}
