package inspectfs

import "testing"

func TestReadInsightStateFoldsInspectStreams(t *testing.T) {
	fs := Open(t.TempDir())

	if _, err := Put(fs, InsightStatus{InsightID: "insight-1", Status: "dismissed"}); err != nil {
		t.Fatalf("put dismissed status: %v", err)
	}
	if _, err := Put(fs, InsightStatus{InsightID: "insight-1", Status: "open"}); err != nil {
		t.Fatalf("put open status: %v", err)
	}
	silence, err := Put(fs, InsightSilence{Pattern: InsightSilencePattern{Title: "Slow run", TargetID: "writer"}})
	if err != nil {
		t.Fatalf("put silence: %v", err)
	}
	silence.DeletedAt = "2026-06-11T10:00:00Z"
	if _, err := Put(fs, silence); err != nil {
		t.Fatalf("put deleted silence: %v", err)
	}

	state, err := fs.ReadInsightState()
	if err != nil {
		t.Fatalf("read insight state: %v", err)
	}
	if got := state.Statuses["insight-1"].Status; got != "open" {
		t.Fatalf("latest status = %q, want open", got)
	}
	if len(state.Silences) != 0 {
		t.Fatalf("active silence count = %d, want 0", len(state.Silences))
	}
	allSilences, err := fs.ReadInsightSilences(true)
	if err != nil {
		t.Fatalf("read deleted silences: %v", err)
	}
	if len(allSilences) != 1 || allSilences[0].DeletedAt == "" {
		t.Fatalf("silence tombstone was not retained: %#v", allSilences)
	}
}
