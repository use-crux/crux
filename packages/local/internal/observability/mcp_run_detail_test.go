package observability

import (
	"context"
	"testing"
)

func TestMCPRunDetailKeepsPreparationChronologicalAndExactlyReferenced(t *testing.T) {
	service := newTestService(t)
	mustIngest(t, service,
		`{"schemaVersion":2,"recordId":"mcp-run","type":"run:start","runId":"run-mcp-detail","segmentId":"seg-mcp-run","segmentSeq":1,"name":"MCP detail","rootPrimitive":"agent.run","startedAt":"2026-07-14T10:00:00.000Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"mcp-agent","type":"span","runId":"run-mcp-detail","segmentId":"seg-mcp-detail","segmentSeq":1,"spanId":"span-agent","family":"agent","primitive":"agent.run","name":"agent","startedAt":"2026-07-14T10:00:00.000Z","endedAt":"2026-07-14T10:00:05.000Z","durationMs":5000,"status":"ok"}`,
		`{"schemaVersion":2,"recordId":"mcp-connect","type":"span","runId":"run-mcp-detail","segmentId":"seg-mcp-detail","segmentSeq":2,"spanId":"span-connect","parentSpanId":"span-agent","family":"mcp","primitive":"mcp.connect","name":"billing","startedAt":"2026-07-14T10:00:01.000Z","endedAt":"2026-07-14T10:00:01.010Z","durationMs":10,"status":"ok","attributes":{"sourceId":"billing","sourceSessionId":"session-1","implementation":"official-client","transport":"streamable-http"},"definitionRefs":[{"id":"mcp.server:billing","kind":"mcp.server","role":"resolved-mcp-server"}]}`,
		`{"schemaVersion":2,"recordId":"mcp-discover","type":"span","runId":"run-mcp-detail","segmentId":"seg-mcp-detail","segmentSeq":3,"spanId":"span-discover","parentSpanId":"span-agent","family":"mcp","primitive":"mcp.discover","name":"billing","startedAt":"2026-07-14T10:00:02.000Z","endedAt":"2026-07-14T10:00:02.020Z","durationMs":20,"status":"ok","attributes":{"sourceId":"billing","sourceSessionId":"session-1","discoveredToolCount":2,"exposedToolCount":1,"toolListFingerprint":"sha256:list"},"definitionRefs":[{"id":"mcp.server:billing","kind":"mcp.server","role":"resolved-mcp-server"}]}`,
		`{"schemaVersion":2,"recordId":"mcp-generation","type":"span","runId":"run-mcp-detail","segmentId":"seg-mcp-detail","segmentSeq":4,"spanId":"span-generation","parentSpanId":"span-agent","family":"generation","primitive":"generation.call","name":"generate","startedAt":"2026-07-14T10:00:03.000Z","endedAt":"2026-07-14T10:00:04.000Z","durationMs":1000,"status":"ok"}`,
		`{"schemaVersion":2,"recordId":"mcp-tool","type":"span","runId":"run-mcp-detail","segmentId":"seg-mcp-detail","segmentSeq":5,"spanId":"span-tool","parentSpanId":"span-generation","family":"tool","primitive":"tool.call","name":"billing_lookup","toolName":"billing_lookup","startedAt":"2026-07-14T10:00:03.200Z","endedAt":"2026-07-14T10:00:03.300Z","durationMs":100,"status":"ok","attributes":{"sourceKind":"mcp","sourceId":"billing","remoteName":"lookup","exposedName":"billing_lookup","discoverSpanId":"span-discover"},"definitionRefs":[{"id":"mcp.server:billing","kind":"mcp.server","role":"resolved-mcp-server"},{"id":"tool:billing_lookup","kind":"tool","role":"invoked-tool"}]}`,
	)

	detail, err := service.RunDetail(context.Background(), "run-mcp-detail")
	if err != nil {
		t.Fatalf("run detail: %v", err)
	}
	if detail.Root.SpanID != "span-agent" {
		t.Fatalf("root span = %q, want span-agent", detail.Root.SpanID)
	}
	wantOrder := []string{"span-connect", "span-discover", "span-generation"}
	if len(detail.Root.Children) < len(wantOrder) {
		t.Fatalf("root children = %d, want at least %d", len(detail.Root.Children), len(wantOrder))
	}
	for index, spanID := range wantOrder {
		if detail.Root.Children[index].SpanID != spanID {
			t.Fatalf("child %d = %q, want %q", index, detail.Root.Children[index].SpanID, spanID)
		}
	}
	tool := findRunDetailNode(&detail.Root, "span-tool")
	if tool == nil || len(tool.DefinitionRefs) != 2 || tool.DefinitionRefs[1].ID != "tool:billing_lookup" {
		t.Fatalf("tool definition refs = %+v", tool)
	}
}

func TestMCPRunDetailKeepsPreparationFailureWithoutProviderSpan(t *testing.T) {
	service := newTestService(t)
	mustIngest(t, service,
		`{"schemaVersion":2,"recordId":"mcp-failed-connect","type":"span","runId":"run-mcp-failure","segmentId":"seg-mcp-failure","segmentSeq":1,"spanId":"span-connect-failed","family":"mcp","primitive":"mcp.connect","name":"billing","startedAt":"2026-07-14T10:00:01.000Z","endedAt":"2026-07-14T10:00:01.010Z","durationMs":10,"status":"error","attributes":{"sourceId":"billing","failurePhase":"connect"},"error":{"name":"McpToolSourceError","message":"MCP connection failed","category":"mcp-connect"},"definitionRefs":[{"id":"mcp.server:billing","kind":"mcp.server","role":"resolved-mcp-server"}]}`,
	)

	detail, err := service.RunDetail(context.Background(), "run-mcp-failure")
	if err != nil {
		t.Fatalf("run detail: %v", err)
	}
	failure := findRunDetailNode(&detail.Root, "span-connect-failed")
	if failure == nil || failure.Primitive != "mcp.connect" || failure.Status != "error" {
		t.Fatalf("MCP failure not inspectable: %+v", failure)
	}
	if findRunDetailNode(&detail.Root, "span-generation") != nil {
		t.Fatal("failure fixture unexpectedly contains provider generation")
	}
}
