package observability

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestTurnDecisionReportEncodesEmptyCollectionsAsArrays(t *testing.T) {
	started := time.Date(2026, 6, 30, 11, 0, 0, 0, time.UTC)
	span := requestGenerationSpan("run_empty_report", "trace_empty_report", "span_generation", "", "generate", started, "prompt.empty")

	report := buildTurnDecisionReport(span, nil)
	raw, err := json.Marshal(report)
	if err != nil {
		t.Fatal(err)
	}
	encoded := string(raw)

	for _, field := range []string{"saw", "considered", "freshness", "cache", "decisions", "source"} {
		if !strings.Contains(encoded, `"`+field+`":[]`) {
			t.Fatalf("%s encoded as %s, want empty array for %q", field, encoded, field)
		}
		if strings.Contains(encoded, `"`+field+`":null`) {
			t.Fatalf("%s encoded as null in %s", field, encoded)
		}
	}
	if strings.Contains(encoded, `"areas":null`) || !strings.Contains(encoded, `"areas":[`) {
		t.Fatalf("coverage areas encoded as %s, want array", encoded)
	}
	if !strings.Contains(encoded, `"gaps":[`) {
		t.Fatalf("gaps encoded as %s, want explicit missing evidence array", encoded)
	}
}
