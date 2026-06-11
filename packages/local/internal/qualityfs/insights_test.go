package qualityfs

import "testing"

func TestSnapshotFoldsInsightStreams(t *testing.T) {
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

	snapshot, err := fs.Snapshot()
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	if got := snapshot.Statuses["insight-1"].Status; got != "open" {
		t.Fatalf("latest status = %q, want open", got)
	}
	if len(snapshot.Silences) != 1 {
		t.Fatalf("silence count = %d, want 1", len(snapshot.Silences))
	}
	if snapshot.Silences[0].DeletedAt == "" {
		t.Fatalf("silence tombstone was not retained: %#v", snapshot.Silences[0])
	}
}
