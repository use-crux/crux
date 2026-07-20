package screens

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/observability"
)

func TestDiagnoseRunProjectsSummaryAndTiming(t *testing.T) {
	detail := api.ObservabilityRunDetail{
		Run: api.ObservabilityRunSummary{
			RunID:      "run-failed",
			Name:       "support-agent",
			Status:     "failed",
			StartedAt:  "2026-07-18T20:00:00Z",
			EndedAt:    "2026-07-18T20:00:02.5Z",
			DurationMs: 2500,
			Model:      "gpt-5",
			Provider:   "openai",
			SpanCount:  3,
		},
	}

	got := DiagnoseRun(detail).Summary
	want := DiagnosisSummary{
		RunID:      "run-failed",
		Name:       "support-agent",
		Status:     "failed",
		StartedAt:  "2026-07-18T20:00:00Z",
		EndedAt:    "2026-07-18T20:00:02.5Z",
		DurationMs: 2500,
		Model:      "gpt-5",
		Provider:   "openai",
		SpanCount:  3,
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("summary = %#v, want %#v", got, want)
	}
}

func TestDiagnoseRunProjectsRunFailureEvidence(t *testing.T) {
	detail := api.ObservabilityRunDetail{
		Run: api.ObservabilityRunSummary{
			RunID: "run-failed", Status: "failed", Error: json.RawMessage(`{"code":"rate_limit","message":"provider rate limit exceeded"}`),
		},
	}

	if got, want := DiagnoseRun(detail).Summary.Failure, "provider rate limit exceeded"; got != want {
		t.Fatalf("failure = %q, want %q", got, want)
	}
}

func TestDiagnoseRunProjectsFailureDiagnosticsInSourceOrder(t *testing.T) {
	runDiagnostic := observability.RunDetailDiagnostic{
		Code: "run.failed", Severity: "error", Message: "generation failed", SuggestedFix: "check the provider response",
	}
	rootDiagnostic := observability.RunDetailDiagnostic{
		Code: "model.timeout", Severity: "error", Message: "model timed out", SpanIDs: []string{"span-root"},
	}
	detailDiagnostic := observability.RunDetailDiagnostic{
		Code: "retry.exhausted", Severity: "warning", Message: "all retries exhausted",
	}
	childDiagnostic := observability.RunDetailDiagnostic{
		Code: "tool.denied", Severity: "error", Message: "tool request was denied",
	}
	detail := api.ObservabilityRunDetail{
		Diagnostics: []observability.RunDetailDiagnostic{runDiagnostic},
		Root: api.ObservabilityRunDetailNode{
			ID:          "span:root",
			Diagnostics: []observability.RunDetailDiagnostic{rootDiagnostic},
			Details: []observability.RunDetailDetail{{
				ID: "detail:retry", Diagnostics: []observability.RunDetailDiagnostic{detailDiagnostic},
			}},
			Children: []observability.RunDetailNode{{
				ID: "span:tool", Diagnostics: []observability.RunDetailDiagnostic{childDiagnostic},
			}},
		},
	}

	got := DiagnoseRun(detail).Diagnostics
	want := []DiagnosisItem{
		{Diagnostic: runDiagnostic},
		{NodeID: "span:root", Diagnostic: rootDiagnostic},
		{NodeID: "detail:retry", Diagnostic: detailDiagnostic},
		{NodeID: "span:tool", Diagnostic: childDiagnostic},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("diagnostics = %#v, want %#v", got, want)
	}
}

func TestDiagnoseRunProjectsDirectToolActivityTimeline(t *testing.T) {
	tool := api.ObservabilityRunDetailNode{
		SpanSummary: api.ObservabilitySpanSummary{
			SpanID: "span-tool", Family: "tool", Primitive: "tool.call", ToolName: "searchDocs",
		},
		ID:       "span:span-tool",
		ParentID: "span:span-root",
		Display:  observability.RunDetailDisplay{Kind: "tool.call", Label: "search docs"},
		Timing:   observability.RunDetailTiming{StartedAt: "2026-07-18T20:00:00.1Z", DurationMs: 125},
	}
	detail := api.ObservabilityRunDetail{
		Root: api.ObservabilityRunDetailNode{
			SpanSummary: api.ObservabilitySpanSummary{SpanID: "span-root", Family: "agent", Primitive: "agent.run"},
			ID:          "span:span-root",
			Display:     observability.RunDetailDisplay{Kind: "agent.run", Label: "support agent"},
			Children:    []observability.RunDetailNode{tool},
		},
	}

	got := DiagnoseRun(detail).Timeline
	if len(got) != 2 {
		t.Fatalf("timeline length = %d, want 2", len(got))
	}
	if got[0].ID != "span-root" || got[0].Depth != 0 || got[0].Span.Name != "support agent" {
		t.Fatalf("root row = %#v, want stable root activity", got[0])
	}
	if got[1].ID != "span-tool" || got[1].Depth != 1 || got[1].Activity.ToolName != "searchDocs" {
		t.Fatalf("tool row = %#v, want direct tool activity", got[1])
	}
	if !reflect.DeepEqual(got[1].Activity, tool) {
		t.Fatalf("tool source = %#v, want exact direct node %#v", got[1].Activity, tool)
	}
}

func TestDiagnoseRunTimelineFallsBackToDirectActivityFields(t *testing.T) {
	detail := api.ObservabilityRunDetail{
		Root: api.ObservabilityRunDetailNode{
			SpanSummary: api.ObservabilitySpanSummary{
				SpanID: "span-tool", ParentSpanID: "span-parent", Family: "tool", Primitive: "tool.call", Name: "search docs",
			},
			ID: "span:span-tool",
		},
	}

	row := DiagnoseRun(detail).Timeline[0]
	if row.Span.Name != "search docs" || row.Span.Kind != "tool" || row.Span.ParentID != "span-parent" {
		t.Fatalf("fallback activity row = %#v, want direct name/family/parent", row.Span)
	}
}

func TestDiagnoseRunProjectsArtifactsAndEvents(t *testing.T) {
	rootArtifact := observability.ArtifactSummary{ArtifactID: "artifact-output", Kind: "output", SizeBytes: 42}
	detailArtifact := observability.ArtifactSummary{ArtifactID: "artifact-request", Kind: "tool.request", SizeBytes: 17}
	childArtifact := observability.ArtifactSummary{ArtifactID: "artifact-result", Kind: "tool.response", SizeBytes: 99}
	rootEvent := observability.SpanEventSummary{EventID: "event-start", Name: "model.request"}
	detailEvent := observability.SpanEventSummary{EventID: "event-retry", Name: "retry.scheduled"}
	childEvent := observability.SpanEventSummary{EventID: "event-end", Name: "tool.completed"}
	detail := api.ObservabilityRunDetail{
		Root: api.ObservabilityRunDetailNode{
			ID:        "span:root",
			Artifacts: []observability.ArtifactSummary{rootArtifact},
			Events:    []observability.SpanEventSummary{rootEvent},
			Details: []observability.RunDetailDetail{{
				ID: "detail:request", Artifacts: []observability.ArtifactSummary{detailArtifact}, Events: []observability.SpanEventSummary{detailEvent},
			}},
			Children: []observability.RunDetailNode{{
				ID: "span:tool", Artifacts: []observability.ArtifactSummary{childArtifact}, Events: []observability.SpanEventSummary{childEvent},
			}},
		},
	}

	diagnosis := DiagnoseRun(detail)
	wantArtifacts := []ArtifactItem{
		{NodeID: "span:root", Artifact: rootArtifact},
		{NodeID: "detail:request", Artifact: detailArtifact},
		{NodeID: "span:tool", Artifact: childArtifact},
	}
	if !reflect.DeepEqual(diagnosis.Artifacts, wantArtifacts) {
		t.Fatalf("artifacts = %#v, want %#v", diagnosis.Artifacts, wantArtifacts)
	}
	wantEvents := []EventItem{
		{NodeID: "span:root", Event: rootEvent},
		{NodeID: "detail:request", Event: detailEvent},
		{NodeID: "span:tool", Event: childEvent},
	}
	if !reflect.DeepEqual(diagnosis.Events, wantEvents) {
		t.Fatalf("events = %#v, want %#v", diagnosis.Events, wantEvents)
	}
}

func TestDiagnoseRunPreservesExactDefinitionReferences(t *testing.T) {
	runRef := observability.DefinitionRef{ID: "agent:billing-v2", Kind: "agent", Role: "invoke"}
	rootRef := observability.DefinitionRef{ID: "prompt:support/reply", Kind: "prompt", Role: "resolve"}
	detailRef := observability.DefinitionRef{ID: "context:account-policy", Kind: "context", Role: "inject"}
	childRef := observability.DefinitionRef{
		ID: "tool:search-docs", Kind: "tool", Role: "call",
		Source: &observability.SanitizedSourceRef{File: "src/tools/search.ts", Line: 27, Column: 3},
	}
	detail := api.ObservabilityRunDetail{
		DefinitionRefs: []observability.DefinitionRef{runRef},
		Root: api.ObservabilityRunDetailNode{
			ID:             "span:root",
			DefinitionRefs: []observability.DefinitionRef{rootRef},
			Details: []observability.RunDetailDetail{{
				ID: "detail:context", DefinitionRefs: []observability.DefinitionRef{detailRef},
			}},
			Children: []observability.RunDetailNode{{
				ID: "span:tool", DefinitionRefs: []observability.DefinitionRef{childRef},
			}},
		},
	}

	got := DiagnoseRun(detail).DefinitionRefs
	want := []observability.DefinitionRef{runRef, rootRef, detailRef, childRef}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("definition refs = %#v, want exact IDs %#v", got, want)
	}
}

func TestDiagnoseRunOmitsAbsentOptionalEvidence(t *testing.T) {
	detail := api.ObservabilityRunDetail{Run: api.ObservabilityRunSummary{RunID: "run-empty", Status: "running"}}

	diagnosis := DiagnoseRun(detail)
	if len(diagnosis.Timeline) != 0 || len(diagnosis.Diagnostics) != 0 ||
		len(diagnosis.DefinitionRefs) != 0 || len(diagnosis.Artifacts) != 0 || len(diagnosis.Events) != 0 {
		t.Fatalf("empty evidence projected phantom sections: %#v", diagnosis)
	}
	if !reflect.DeepEqual(diagnosis.Raw, detail) {
		t.Fatalf("raw detail = %#v, want source %#v", diagnosis.Raw, detail)
	}
}
