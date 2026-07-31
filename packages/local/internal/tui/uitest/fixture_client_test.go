package uitest

import (
	"context"
	"testing"

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
