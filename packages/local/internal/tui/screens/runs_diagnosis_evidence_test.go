package screens

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/observability"
)

func TestDiagnoseRunProjectsChildFailureAndAbnormalOperation(t *testing.T) {
	detail := api.ObservabilityRunDetail{
		Root: api.ObservabilityRunDetailNode{
			SpanSummary: api.ObservabilitySpanSummary{SpanID: "span-root", Status: "ok", DurationMs: 100},
			Children: []observability.RunDetailNode{{
				SpanSummary: api.ObservabilitySpanSummary{
					SpanID: "span-tool", ParentSpanID: "span-root", Name: "search docs", Status: "failed",
					DurationMs: 80, Error: json.RawMessage(`{"message":"provider request failed"}`),
				},
				ID: "span:span-tool",
			}},
		},
	}

	diagnosis := DiagnoseRun(detail)
	if got, want := diagnosis.Failures, []FailureItem{{NodeID: "span-tool", Message: "provider request failed"}}; !reflect.DeepEqual(got, want) {
		t.Fatalf("failures = %#v, want %#v", got, want)
	}
	if got, want := diagnosis.Operations, []OperationDiagnosis{{NodeID: "span-tool", Name: "search docs", Status: "failed", Evidence: "failed status"}}; !reflect.DeepEqual(got, want) {
		t.Fatalf("operations = %#v, want %#v", got, want)
	}
}

func TestDiagnoseRunProjectsTimingInferredCriticalPath(t *testing.T) {
	detail := api.ObservabilityRunDetail{Root: api.ObservabilityRunDetailNode{
		SpanSummary: api.ObservabilitySpanSummary{SpanID: "root", Name: "root", DurationMs: 100},
		Children: []observability.RunDetailNode{
			{SpanSummary: api.ObservabilitySpanSummary{SpanID: "short", ParentSpanID: "root", Name: "short", DurationMs: 20}},
			{SpanSummary: api.ObservabilitySpanSummary{SpanID: "long", ParentSpanID: "root", Name: "long", DurationMs: 70}, Children: []observability.RunDetailNode{
				{SpanSummary: api.ObservabilitySpanSummary{SpanID: "leaf", ParentSpanID: "long", Name: "leaf", DurationMs: 50}},
			}},
		},
	}}

	path := DiagnoseRun(detail).CriticalPath
	if got, want := runRowIDs(path), []string{"root", "long", "leaf"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("critical path = %#v, want %#v", got, want)
	}
}

func TestDiagnoseRunProjectsExplicitRetryActivity(t *testing.T) {
	detail := api.ObservabilityRunDetail{Root: api.ObservabilityRunDetailNode{
		SpanSummary: api.ObservabilitySpanSummary{SpanID: "retry", Name: "retry route", Primitive: "routing.retry", Status: "ok"},
	}}

	got := DiagnoseRun(detail).Operations
	want := []OperationDiagnosis{{NodeID: "retry", Name: "retry route", Status: "ok", Evidence: "retry activity"}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("operations = %#v, want explicit retry %#v", got, want)
	}
}

func TestDiagnoseRunProjectsAbnormalAttachedDetailOperation(t *testing.T) {
	detail := api.ObservabilityRunDetail{Root: api.ObservabilityRunDetailNode{
		SpanSummary: api.ObservabilitySpanSummary{SpanID: "root", Status: "ok"},
		Details: []observability.RunDetailDetail{{
			SpanSummary: api.ObservabilitySpanSummary{SpanID: "route-retry", Name: "retry route", Primitive: "routing.retry", Status: "failed"},
			ID:          "detail:route-retry",
		}},
	}}

	got := DiagnoseRun(detail).Operations
	want := []OperationDiagnosis{
		{NodeID: "route-retry", Name: "retry route", Status: "failed", Evidence: "failed status"},
		{NodeID: "route-retry", Name: "retry route", Status: "failed", Evidence: "retry activity"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("operations = %#v, want attached detail evidence %#v", got, want)
	}
}

func TestDiagnoseRunDeduplicatesRunAndVirtualRootFailure(t *testing.T) {
	errorPayload := json.RawMessage(`{"message":"run failed before activity began"}`)
	detail := api.ObservabilityRunDetail{
		Run: api.ObservabilityRunSummary{RunID: "failed", Error: errorPayload},
		Root: api.ObservabilityRunDetailNode{
			SpanSummary: api.ObservabilitySpanSummary{RunID: "failed", Error: errorPayload},
			ID:          "run:failed",
			Virtual:     true,
		},
	}

	got := DiagnoseRun(detail).Failures
	want := []FailureItem{{Message: "run failed before activity began"}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("failures = %#v, want virtual-root failure once %#v", got, want)
	}
}

func TestDiagnoseRunRetainsDistinctFailuresWithSameMessage(t *testing.T) {
	runError := json.RawMessage(`{"code":"RUN","message":"failed"}`)
	toolError := json.RawMessage(`{"code":"TOOL","message":"failed"}`)
	detail := api.ObservabilityRunDetail{
		Run: api.ObservabilityRunSummary{RunID: "failed", Error: runError},
		Root: api.ObservabilityRunDetailNode{
			SpanSummary: api.ObservabilitySpanSummary{RunID: "failed", Error: runError},
			ID:          "run:failed",
			Virtual:     true,
			Children: []observability.RunDetailNode{{
				SpanSummary: api.ObservabilitySpanSummary{SpanID: "tool", Name: "tool", Error: toolError},
				ID:          "span:tool",
			}},
		},
	}

	got := DiagnoseRun(detail).Failures
	want := []FailureItem{{Message: "failed"}, {NodeID: "tool", Message: "failed"}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("failures = %#v, want distinct raw failures %#v", got, want)
	}
}

func TestDiagnoseRunOmitsCriticalPathWithoutPositiveTiming(t *testing.T) {
	detail := api.ObservabilityRunDetail{Root: api.ObservabilityRunDetailNode{
		SpanSummary: api.ObservabilitySpanSummary{SpanID: "root", Name: "running root"},
		Children: []observability.RunDetailNode{{SpanSummary: api.ObservabilitySpanSummary{
			SpanID: "child", ParentSpanID: "root", Name: "untimed child",
		}}},
	}}

	if got := DiagnoseRun(detail).CriticalPath; len(got) != 0 {
		t.Fatalf("critical path = %#v, want no timing inference without timing evidence", got)
	}
}

func TestDiagnoseRunDeduplicatesCanonicalDiagnosticsAndAssociatesActivity(t *testing.T) {
	diagnostic := observability.RunDetailDiagnostic{
		Code: "missing-span-end", Severity: "warn", Message: "span has no end record", SpanIDs: []string{"span-tool"},
	}
	detail := api.ObservabilityRunDetail{
		Diagnostics: []observability.RunDetailDiagnostic{diagnostic},
		Root: api.ObservabilityRunDetailNode{
			SpanSummary: api.ObservabilitySpanSummary{SpanID: "span-tool"},
			ID:          "span:span-tool",
			Diagnostics: []observability.RunDetailDiagnostic{diagnostic},
		},
	}

	got := DiagnoseRun(detail).Diagnostics
	want := []DiagnosisItem{{NodeID: "span-tool", Diagnostic: diagnostic}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("diagnostics = %#v, want one activity-associated item %#v", got, want)
	}
}

func TestDiagnoseRunUsesCanonicalDefinitionReferencesWithoutDuplicates(t *testing.T) {
	ref := observability.DefinitionRef{ID: "tool:search-docs", Kind: "tool", Role: "call"}
	detail := api.ObservabilityRunDetail{
		DefinitionRefs: []observability.DefinitionRef{ref},
		Root: api.ObservabilityRunDetailNode{
			SpanSummary:    api.ObservabilitySpanSummary{SpanID: "span-tool"},
			ID:             "span:span-tool",
			DefinitionRefs: []observability.DefinitionRef{ref},
		},
	}

	if got := DiagnoseRun(detail).DefinitionRefs; !reflect.DeepEqual(got, []observability.DefinitionRef{ref}) {
		t.Fatalf("definition refs = %#v, want canonical ref once", got)
	}
}

func TestDiagnoseRunPreservesDistinctDefinitionReferenceMetadataForOneIDAndRole(t *testing.T) {
	firstSource := &observability.SanitizedSourceRef{File: "src/agent.ts", Line: 10}
	secondSource := &observability.SanitizedSourceRef{File: "src/router.ts", Line: 20, Column: 4}
	detail := api.ObservabilityRunDetail{
		DefinitionRefs: []observability.DefinitionRef{
			{ID: "agent:shared", Kind: "agent", Role: "invoke", Source: firstSource},
			{ID: "agent:shared", Kind: "router", Role: "invoke", Source: secondSource},
		},
		Root: api.ObservabilityRunDetailNode{ID: "root"},
	}

	want := append([]observability.DefinitionRef(nil), detail.DefinitionRefs...)
	if got := DiagnoseRun(detail).DefinitionRefs; !reflect.DeepEqual(got, want) {
		t.Fatalf("definition refs lost distinct kind/source metadata:\n got %#v\nwant %#v", got, want)
	}
}
