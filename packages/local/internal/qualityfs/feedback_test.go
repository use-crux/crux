package qualityfs

import "testing"

func TestSnapshotObservesExternalWritersAndAppliesFeedbackAnnotations(t *testing.T) {
	fs := Open(t.TempDir())

	feedback, err := Put(fs, Feedback{TraceID: stringPtr("trace-1"), Status: "new"})
	if err != nil {
		t.Fatalf("put feedback: %v", err)
	}
	if _, err := fs.Snapshot(); err != nil {
		t.Fatalf("initial snapshot: %v", err)
	}

	_, err = Put(fs, FeedbackAnnotation{
		FeedbackID: feedback.ID,
		Status:     "reviewed",
		Tags:       []string{"regression"},
		Metadata:   map[string]any{"source": "human"},
	})
	if err != nil {
		t.Fatalf("put annotation: %v", err)
	}

	snapshot, err := fs.Snapshot()
	if err != nil {
		t.Fatalf("annotated snapshot: %v", err)
	}
	if got := snapshot.Feedback[0].Status; got != "reviewed" {
		t.Fatalf("feedback status = %q, want reviewed", got)
	}
	if got := snapshot.ByTrace.FeedbackIDs["trace-1"]; len(got) != 1 || got[0] != feedback.ID {
		t.Fatalf("feedback join = %#v, want [%q]", got, feedback.ID)
	}
	if got := snapshot.Feedback[0].Tags; len(got) != 1 || got[0] != "regression" {
		t.Fatalf("feedback tags = %#v, want [regression]", got)
	}
	if got := snapshot.Feedback[0].Metadata["source"]; got != "human" {
		t.Fatalf("feedback metadata source = %#v, want human", got)
	}
}
