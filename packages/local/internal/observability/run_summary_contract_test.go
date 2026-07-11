package observability

import (
	"encoding/json"
	"testing"
)

// TestRunSummaryJSONFieldSetMatchesDevtoolsContract guards the one shared
// wire contract between this Go struct (also aliased as
// api.ObservabilityRunSummary) and the hand-maintained TypeScript mirror at
// packages/devtools/ui/src/types.ts (`ObservabilityRunSummary`). There is no
// codegen step between the two (binding spec 04 §6's "generated/shared where
// practical" — this is the smallest repository-native guard): if a field is
// renamed, added, or removed here without updating the TS interface, this
// test fails loudly instead of the drift silently reaching the Runs UI.
func TestRunSummaryJSONFieldSetMatchesDevtoolsContract(t *testing.T) {
	summary := RunSummary{
		RunID:              "run_1",
		TraceID:            "trace_1",
		SessionID:          "session_1",
		UserID:             "user_1",
		Name:               "n",
		RootPrimitive:      "agent.run",
		Status:             "ok",
		StartedAt:          "2026-07-11T00:00:00Z",
		EndedAt:            "2026-07-11T00:00:01Z",
		DurationMs:         1000,
		Model:              "m",
		Provider:           "p",
		PromptID:           "prompt_1",
		RecordCount:        1,
		SpanCount:          1,
		EventCount:         1,
		ArtifactCount:      1,
		EdgeCount:          1,
		SegmentCount:       1,
		ActiveSegmentID:    "segment_1",
		OrderingConfidence: "causal",
		GapCount:           0,
		TraceAliasConflict: true,
		LastActivityAt:     "2026-07-11T00:00:01Z",
		Revision:           1,
		DeliveryHealth:     &RunDeliveryHealth{Status: "healthy"},
	}

	raw, err := json.Marshal(summary)
	if err != nil {
		t.Fatalf("marshal RunSummary: %v", err)
	}
	var decoded map[string]json.RawMessage
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("unmarshal RunSummary: %v", err)
	}

	// Mirrors packages/devtools/ui/src/types.ts's `ObservabilityRunSummary`
	// field set exactly (optional TS fields are still always emitted here
	// because every value above is non-zero/non-empty).
	expectedFields := []string{
		"runId", "traceId", "sessionId", "userId", "name", "rootPrimitive",
		"status", "startedAt", "endedAt", "lastActivityAt", "durationMs",
		"model", "provider", "promptId", "recordCount", "spanCount",
		"eventCount", "artifactCount", "edgeCount", "segmentCount",
		"activeSegmentId", "orderingConfidence", "gapCount",
		"traceAliasConflict", "revision", "deliveryHealth",
	}
	for _, field := range expectedFields {
		if _, ok := decoded[field]; !ok {
			t.Errorf("RunSummary JSON is missing field %q expected by the devtools TS contract", field)
		}
	}
	for field := range decoded {
		found := false
		for _, expected := range expectedFields {
			if field == expected {
				found = true
				break
			}
		}
		// attributes/metrics/error are optional JSON payload fields the TS
		// contract also declares but this fixture leaves unset (omitempty).
		if !found && field != "attributes" && field != "metrics" && field != "error" {
			t.Errorf("RunSummary JSON has field %q not reflected in the devtools TS contract — update packages/devtools/ui/src/types.ts", field)
		}
	}
}
