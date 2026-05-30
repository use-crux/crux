package commands

import (
	"testing"

	"github.com/use-crux/crux/packages/cli/internal/api"
)

func TestSuiteCaseFromTrace(t *testing.T) {
	text := "Refunds are available within 30 days."
	graph := api.ObservabilityGraph{
		Run: api.ObservabilityRunSummary{
			RunID:    "run-1",
			TraceID:  "tr-1",
			PromptID: "support",
			Model:    "gpt-4o",
			Provider: "openai",
			Status:   "ok",
		},
		Artifacts: []api.ObservabilityArtifactSummary{
			{Kind: "input", Preview: []byte(`{"question":"How do refunds work?"}`)},
			{Kind: "output", Preview: []byte(`{"text":"Refunds are available within 30 days."}`)},
		},
	}

	testCase := suiteCaseFromGraph(graph, exportTraceOptions{
		caseID:        "refunds",
		tag:           "regression",
		includeActual: true,
	})

	if testCase.ID != "refunds" {
		t.Fatalf("case id = %q, want refunds", testCase.ID)
	}
	if testCase.Input["question"] != "How do refunds work?" {
		t.Fatalf("input = %#v", testCase.Input)
	}
	if testCase.Tags[0] != "regression" {
		t.Fatalf("tags = %#v", testCase.Tags)
	}
	if testCase.Metadata["traceId"] != "tr-1" || testCase.Metadata["promptId"] != "support" {
		t.Fatalf("metadata = %#v", testCase.Metadata)
	}
	actual, ok := testCase.Metadata["actual"].(map[string]any)
	if !ok || actual["text"] != text {
		t.Fatalf("actual metadata = %#v", testCase.Metadata["actual"])
	}
}

func TestSuiteCaseFromFeedback(t *testing.T) {
	traceID := "tr-1"
	caseID := "okta-sso-regression"
	rating := -1
	comment := "Wrong source cited."
	feedback := api.QualityFeedbackRecord{
		ID:      "fb-1",
		TraceID: &traceID,
		CaseID:  &caseID,
		Rating:  &rating,
		Comment: &comment,
		Expected: map[string]interface{}{
			"sources": []interface{}{map[string]interface{}{"sourceId": "sso.md"}},
		},
		Tags: []string{"citation"},
	}
	graph := api.ObservabilityGraph{
		Run: api.ObservabilityRunSummary{RunID: "run-1", TraceID: traceID},
		Artifacts: []api.ObservabilityArtifactSummary{
			{Kind: "messages", Preview: []byte(`{"question":"Why did Okta SSO fail?"}`)},
		},
	}

	testCase := suiteCaseFromFeedback(feedback, graph, exportTraceOptions{
		tag:           "regression",
		includeActual: true,
	})

	if testCase.ID != "okta-sso-regression" {
		t.Fatalf("case id = %q, want okta-sso-regression", testCase.ID)
	}
	if testCase.Input["question"] != "Why did Okta SSO fail?" {
		t.Fatalf("input = %#v", testCase.Input)
	}
	if testCase.Expected["sources"] == nil {
		t.Fatalf("expected sources missing: %#v", testCase.Expected)
	}
	if len(testCase.Tags) != 2 || testCase.Tags[0] != "citation" || testCase.Tags[1] != "regression" {
		t.Fatalf("tags = %#v", testCase.Tags)
	}
	if testCase.Metadata["qualityFeedbackId"] != "fb-1" || testCase.Metadata["rating"] != -1 {
		t.Fatalf("metadata = %#v", testCase.Metadata)
	}
}

func TestRenderFeedbackRating(t *testing.T) {
	if got := renderFeedbackRating(1); got == "" {
		t.Fatal("positive feedback rating should render")
	}
	if got := renderFeedbackRating(-1); got == "" {
		t.Fatal("negative feedback rating should render")
	}
	if got := renderFeedbackRating(0); got == "" {
		t.Fatal("neutral feedback rating should render")
	}
}

func TestAppendUnique(t *testing.T) {
	values := appendUnique([]string{"citation"}, "regression")
	values = appendUnique(values, "citation")
	if len(values) != 2 || values[0] != "citation" || values[1] != "regression" {
		t.Fatalf("values = %#v", values)
	}
}

func TestQualitySideFromRef(t *testing.T) {
	side := qualitySideFromRef("support-v2:sonnet", "Candidate")
	if side.Experiment != "support-v2" {
		t.Fatalf("experiment = %q, want support-v2", side.Experiment)
	}
	if side.VariantID == nil || *side.VariantID != "sonnet" {
		t.Fatalf("variant = %#v, want sonnet", side.VariantID)
	}
	if side.Label == nil || *side.Label != "Candidate" {
		t.Fatalf("label = %#v, want Candidate", side.Label)
	}
}
