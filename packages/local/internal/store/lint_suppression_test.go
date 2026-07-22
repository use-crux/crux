package store

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestIndexLintSuppressionMetadataRoundTrips(t *testing.T) {
	want := IndexLintFinding{
		ID:         "suppressed",
		Suppressed: true,
		SuppressedBy: &IndexLintSuppressedBy{
			Source: &SourceLoc{File: "src/workflow.ts", Line: 7},
			Scope:  "next-line",
			Reason: "intentional handoff",
		},
	}

	encoded, err := json.Marshal(want)
	if err != nil {
		t.Fatal(err)
	}
	var got IndexLintFinding
	if err := json.Unmarshal(encoded, &got); err != nil {
		t.Fatal(err)
	}
	if !got.Suppressed || got.SuppressedBy == nil || got.SuppressedBy.Source == nil {
		t.Fatalf("round trip = %+v, want retained suppression metadata", got)
	}
	if got.SuppressedBy.Scope != "next-line" || got.SuppressedBy.Reason != "intentional handoff" {
		t.Fatalf("suppressedBy = %+v, want exact scope and reason", got.SuppressedBy)
	}

	active, err := json.Marshal(IndexLintFinding{ID: "active"})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(active), "suppressed") {
		t.Fatalf("active JSON = %s, want canonical omission", active)
	}
}
