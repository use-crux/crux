package observability

import (
	"context"
	"reflect"
	"testing"
	"time"
)

func TestProjectRunDetailProjectsRedactionEvidenceBySemanticOwner(t *testing.T) {
	now := time.Date(2026, 7, 28, 10, 0, 0, 0, time.UTC)
	graph := Graph{
		Run: RunSummary{
			RunID: "run_redaction", OperationID: "run_redaction",
			Name: "redaction projection", RootPrimitive: "agent.run",
			Status: "ok", StartedAt: now.Format(time.RFC3339Nano),
		},
		Spans: []SpanSummary{
			{RunID: "run_redaction", SpanID: "span_agent", Family: "agent", Primitive: "agent.run", Name: "agent", Status: "ok", StartedAt: now.Format(time.RFC3339Nano)},
			{RunID: "run_redaction", SpanID: "span_generation", ParentSpanID: "span_agent", Family: "generation", Primitive: "generation.call", Name: "generation", Status: "ok", StartedAt: now.Format(time.RFC3339Nano)},
			{RunID: "run_redaction", SpanID: "span_prompt", ParentSpanID: "span_generation", Family: "prompt", Primitive: "prompt.resolve", Name: "prompt", Status: "ok", StartedAt: now.Format(time.RFC3339Nano)},
			{RunID: "run_redaction", SpanID: "span_tool", ParentSpanID: "span_generation", Family: "tool", Primitive: "tool.call", Name: "tool", Status: "ok", StartedAt: now.Format(time.RFC3339Nano)},
		},
		Events: []SpanEventSummary{{
			EventID: "event_generation", RunID: "run_redaction",
			SpanID: "span_generation", Name: "usage.observed",
			Timestamp: now.Format(time.RFC3339Nano),
		}},
		Artifacts: []ArtifactSummary{{
			ArtifactID: "artifact_generation", RunID: "run_redaction",
			SpanID: "span_generation", Kind: "output",
			CreatedAt:   now.Format(time.RFC3339Nano),
			ContentType: "application/json", Encoding: "json",
		}},
		Edges: []EdgeSummary{
			{EdgeID: "edge_generation", RunID: "run_redaction", EdgeType: "explains", From: NodeRef{Kind: "span", ID: "span_prompt"}, To: NodeRef{Kind: "span", ID: "span_generation"}, CreatedAt: now.Format(time.RFC3339Nano)},
			{EdgeID: "edge_unresolved", RunID: "run_redaction", EdgeType: "custom.private", From: NodeRef{Kind: "span", ID: "span_missing"}, To: NodeRef{Kind: "span", ID: "span_tool"}, CreatedAt: now.Format(time.RFC3339Nano)},
		},
		Records: []StoredRecord{
			redactionStoredRecord("run-own", RecordRunStart, ``, `["attributes"]`),
			redactionStoredRecord("generation-span", RecordSpan, `"spanId":"span_generation",`, `["attributes"]`),
			redactionStoredRecord("generation-event", RecordSpanEvent, `"spanId":"span_generation","eventId":"event_generation",`, `["error.message"]`),
			redactionStoredRecord("generation-artifact", RecordArtifact, `"spanId":"span_generation","artifactId":"artifact_generation",`, `["future.surface","artifact.preview","artifact.preview"]`),
			redactionStoredRecord("generation-edge", RecordEdge, `"edgeId":"edge_generation","from":{"kind":"span","id":"span_prompt"},"to":{"kind":"span","id":"span_generation"},`, `["artifact.uri"]`),
			redactionStoredRecord("prompt-span", RecordSpan, `"spanId":"span_prompt",`, `["artifact.preview"]`),
			redactionStoredRecord("tool-span", RecordSpan, `"spanId":"span_tool",`, `["error.message"]`),
			redactionStoredRecord("unresolved-edge", RecordEdge, `"edgeId":"edge_unresolved","from":{"kind":"span","id":"span_missing"},"to":{"kind":"span","id":"span_tool"},`, `["artifact.uri"]`),
			{RecordID: "old-record", Type: RecordSpan, PayloadJSON: `{"type":"span","spanId":"span_generation"}`},
		},
	}

	detail := ProjectRunDetail(graph, ProjectionOptions{Now: now})
	generation := findRedactionNode(t, &detail.Root, "span_generation")
	tool := findRedactionNode(t, &detail.Root, "span_tool")
	prompt := findRedactionDetail(t, &detail.Root, "span_prompt")

	assertRedactionSurfaces(t, generation.Redaction,
		RedactionSurfaceArtifactPreview,
		RedactionSurfaceAttributes,
		RedactionSurfaceErrorMessage,
	)
	assertRedactionSurfaces(t, prompt.Redaction,
		RedactionSurfaceArtifactPreview,
		RedactionSurfaceArtifactURI,
	)
	assertRedactionSurfaces(t, tool.Redaction, RedactionSurfaceErrorMessage)
	assertRedactionSurfaces(t, generation.Artifacts[0].Redaction, RedactionSurfaceArtifactPreview)
	assertRedactionSurfaces(t, detail.Redaction,
		RedactionSurfaceArtifactPreview,
		RedactionSurfaceArtifactURI,
		RedactionSurfaceAttributes,
		RedactionSurfaceErrorMessage,
	)
	assertRedactionSurfaces(t, detail.Root.Redaction,
		RedactionSurfaceArtifactPreview,
		RedactionSurfaceArtifactURI,
		RedactionSurfaceAttributes,
		RedactionSurfaceErrorMessage,
	)
	if reflect.DeepEqual(generation.Redaction.Surfaces, detail.Redaction.Surfaces) {
		t.Fatal("parent node inherited descendant-only redaction evidence")
	}
}

func TestRunDetailAggregatesRedactionOnlyAtOperationFamilyRoot(t *testing.T) {
	service := newTestService(t)
	ctx := context.Background()
	if err := service.Ingest(ctx, mustBatch(t,
		`{"schemaVersion":4,"recordId":"family-root","type":"run:start","runId":"run_family_redaction","operationId":"run_family_redaction","segmentId":"root-seg","segmentSeq":1,"name":"root","rootPrimitive":"agent.run","startedAt":"2026-07-28T10:00:00Z","status":"running","privacy":{"redaction":{"applied":true,"surfaces":["attributes"]}}}`,
		`{"schemaVersion":4,"recordId":"family-child","type":"run:start","runId":"run_family_child","operationId":"run_family_redaction","parentRunId":"run_family_redaction","segmentId":"child-seg","segmentSeq":1,"name":"child","rootPrimitive":"flow.run","startedAt":"2026-07-28T10:00:01Z","status":"running","privacy":{"redaction":{"applied":true,"surfaces":["error.message"]}}}`,
	)); err != nil {
		t.Fatal(err)
	}

	detail, err := service.RunDetail(ctx, "run_family_redaction")
	if err != nil {
		t.Fatal(err)
	}
	assertRedactionSurfaces(t, detail.Redaction,
		RedactionSurfaceAttributes,
		RedactionSurfaceErrorMessage,
	)
	assertRedactionSurfaces(t, detail.Root.Redaction,
		RedactionSurfaceAttributes,
		RedactionSurfaceErrorMessage,
	)
	if len(detail.MemberRuns) != 2 {
		t.Fatalf("member runs = %d, want 2", len(detail.MemberRuns))
	}
	for _, member := range detail.MemberRuns {
		switch member.Run.RunID {
		case "run_family_redaction":
			assertRedactionSurfaces(t, member.Root.Redaction, RedactionSurfaceAttributes)
		case "run_family_child":
			assertRedactionSurfaces(t, member.Root.Redaction, RedactionSurfaceErrorMessage)
		}
	}
}

func redactionStoredRecord(id string, recordType RecordType, fields, surfaces string) StoredRecord {
	return StoredRecord{
		RecordID: id,
		Type:     recordType,
		PayloadJSON: `{"recordId":"` + id + `","type":"` + string(recordType) +
			`","runId":"run_redaction",` + fields +
			`"privacy":{"redaction":{"applied":true,"surfaces":` + surfaces + `}}}`,
	}
}

func findRedactionNode(t *testing.T, node *RunDetailNode, spanID string) *RunDetailNode {
	t.Helper()
	if node.SpanID == spanID {
		return node
	}
	for i := range node.Children {
		if found := findRedactionNodeMaybe(&node.Children[i], spanID); found != nil {
			return found
		}
	}
	t.Fatalf("node for span %q not found", spanID)
	return nil
}

func findRedactionNodeMaybe(node *RunDetailNode, spanID string) *RunDetailNode {
	if node.SpanID == spanID {
		return node
	}
	for i := range node.Children {
		if found := findRedactionNodeMaybe(&node.Children[i], spanID); found != nil {
			return found
		}
	}
	return nil
}

func findRedactionDetail(t *testing.T, node *RunDetailNode, spanID string) *RunDetailDetail {
	t.Helper()
	for i := range node.Details {
		if node.Details[i].SpanID == spanID {
			return &node.Details[i]
		}
	}
	for i := range node.Children {
		if found := findRedactionDetailMaybe(&node.Children[i], spanID); found != nil {
			return found
		}
	}
	t.Fatalf("detail for span %q not found", spanID)
	return nil
}

func findRedactionDetailMaybe(node *RunDetailNode, spanID string) *RunDetailDetail {
	for i := range node.Details {
		if node.Details[i].SpanID == spanID {
			return &node.Details[i]
		}
	}
	for i := range node.Children {
		if found := findRedactionDetailMaybe(&node.Children[i], spanID); found != nil {
			return found
		}
	}
	return nil
}

func assertRedactionSurfaces(t *testing.T, evidence *ObservabilityRedactionEvidence, want ...ObservabilityRedactionSurface) {
	t.Helper()
	if evidence == nil || !evidence.Applied || !reflect.DeepEqual(evidence.Surfaces, want) {
		t.Fatalf("redaction evidence = %#v, want applied surfaces %#v", evidence, want)
	}
}
