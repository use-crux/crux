package qualitycmd

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
)

func TestQualityImportTracesRowsCarryProvenance(t *testing.T) {
	detail := api.ObservabilityRunDetail{
		Run: api.ObservabilityRunSummary{
			RunID:     "run_123",
			TraceID:   "trace_123",
			StartedAt: "2026-07-08T12:00:00.000Z",
			Status:    "ok",
			PromptID:  "prompt:fixture.greeter",
		},
		Root: api.ObservabilityRunDetailNode{
			Artifacts: []api.ObservabilityArtifactSummary{
				{Kind: "input", Preview: json.RawMessage(`{"q":"hi"}`)},
				{Kind: "output", Preview: json.RawMessage(`{"answer":"hello"}`)},
			},
		},
	}

	rows, skipped := qualityImportRowsFromDetails([]api.ObservabilityRunDetail{detail}, true)

	if len(skipped) != 0 {
		t.Fatalf("skipped = %+v", skipped)
	}
	if len(rows) != 1 {
		t.Fatalf("rows = %d, want 1", len(rows))
	}
	line, err := rows[0].jsonLine()
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		`"input":{"q":"hi"}`,
		`"expected":{"answer":"hello"}`,
		`"tags":["trace-import"]`,
		`"traceId":"trace_123"`,
		`"observedAt":"2026-07-08T12:00:00.000Z"`,
		`"source":"trace-import"`,
	} {
		if !strings.Contains(line, want) {
			t.Fatalf("row missing %s:\n%s", want, line)
		}
	}
}

func TestQualityImportDefinitionMatchesPromptPrefixForms(t *testing.T) {
	for _, tc := range []struct {
		definition string
		promptID   string
	}{
		{definition: "fixture.greeter", promptID: "fixture.greeter"},
		{definition: "prompt:fixture.greeter", promptID: "fixture.greeter"},
		{definition: "fixture.greeter", promptID: "prompt:fixture.greeter"},
	} {
		if !qualityImportDefinitionMatches(tc.definition, tc.promptID) {
			t.Fatalf("expected %q to match %q", tc.definition, tc.promptID)
		}
	}
}
