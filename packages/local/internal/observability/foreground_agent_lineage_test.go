package observability

import (
	"encoding/json"
	"testing"
	"time"
)

func TestProjectRunDetailPreservesForegroundAgentToolLineage(t *testing.T) {
	started := time.Date(2026, 8, 2, 10, 0, 0, 0, time.UTC)
	graph := Graph{
		Run: RunSummary{RunID: "run_lineage", TraceID: "trace_lineage", Name: "Parent agent", RootPrimitive: "agent.run", Status: "ok", StartedAt: started.Format(time.RFC3339Nano)},
		Spans: []SpanSummary{
			{RunID: "run_lineage", TraceID: "trace_lineage", SpanID: "parent", Family: "agent", Primitive: "agent.run", Name: "Parent agent", Status: "ok", StartedAt: started.Format(time.RFC3339Nano)},
			{RunID: "run_lineage", TraceID: "trace_lineage", SpanID: "tool", ParentSpanID: "parent", Family: "tool", Primitive: "tool.call", Name: "delegateResearch", Status: "ok", StartedAt: started.Add(time.Second).Format(time.RFC3339Nano)},
			{RunID: "run_lineage", TraceID: "trace_lineage", SpanID: "child", ParentSpanID: "tool", Family: "agent", Primitive: "agent.run", Name: "Research agent", Status: "ok", StartedAt: started.Add(2 * time.Second).Format(time.RFC3339Nano), Attributes: json.RawMessage(`{"agentId":"research.agent"}`)},
		},
	}

	detail := ProjectRunDetail(graph, ProjectionOptions{Now: started.Add(3 * time.Second)})
	if len(detail.Root.Children) != 1 || detail.Root.Children[0].SpanID != "tool" {
		t.Fatalf("parent children = %#v, want tool as its only primary child", detail.Root.Children)
	}
	tool := detail.Root.Children[0]
	if len(tool.Children) != 1 || tool.Children[0].SpanID != "child" || tool.Children[0].Primitive != "agent.run" {
		t.Fatalf("tool children = %#v, want nested child agent.run", tool.Children)
	}
	if got := string(tool.Children[0].Attributes); got != `{"agentId":"research.agent"}` {
		t.Fatalf("child attributes = %s, want safe authored identity only", got)
	}
}
