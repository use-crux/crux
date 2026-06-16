package qualityfs

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSnapshotHandlesDefaultsMissingDirectoriesAndPartialErrors(t *testing.T) {
	if got := Open("").Dir(); got != filepath.Join(".crux", "quality") {
		t.Fatalf("default dir = %q, want .crux/quality", got)
	}

	missingFS := Open(filepath.Join(t.TempDir(), "missing"))
	empty, err := missingFS.Snapshot()
	if err != nil {
		t.Fatalf("missing snapshot: %v", err)
	}
	if empty == nil || len(empty.Experiments) != 0 || empty.Statuses == nil || empty.ByTrace.ExperimentIDs == nil {
		t.Fatalf("missing snapshot was not empty but initialized: %#v", empty)
	}

	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "experiments"), 0755); err != nil {
		t.Fatalf("mkdir experiments: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "suites"), 0755); err != nil {
		t.Fatalf("mkdir suites: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "experiments", "experiment-1.json"), []byte(`{"id":"experiment-1","suite":{"id":"suite-1"},"summary":{"total":1},"cases":[]}`), 0644); err != nil {
		t.Fatalf("write experiment: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "suites", "broken.json"), []byte(`{`), 0644); err != nil {
		t.Fatalf("write broken suite: %v", err)
	}

	partial, err := Open(dir).Snapshot()
	if err == nil {
		t.Fatalf("partial snapshot error = nil, want suite parse error")
	}
	if partial == nil || len(partial.Experiments) != 1 {
		t.Fatalf("partial snapshot experiments = %#v, want one experiment", partial)
	}
}

func TestSnapshotReturnsImmutableValues(t *testing.T) {
	fs := Open(t.TempDir())

	feedback, err := Put(fs, Feedback{TraceID: stringPtr("trace-1"), Comment: stringPtr("useful")})
	if err != nil {
		t.Fatalf("put feedback: %v", err)
	}

	first, err := fs.Snapshot()
	if err != nil {
		t.Fatalf("first snapshot: %v", err)
	}
	if len(first.Feedback) != 1 {
		t.Fatalf("feedback count = %d, want 1", len(first.Feedback))
	}
	first.Feedback[0].ID = "mutated"
	first.ByTrace.FeedbackIDs["trace-1"][0] = "mutated"

	second, err := fs.Snapshot()
	if err != nil {
		t.Fatalf("second snapshot: %v", err)
	}
	if second.Feedback[0].ID != feedback.ID {
		t.Fatalf("cached snapshot was mutable: got feedback ID %q, want %q", second.Feedback[0].ID, feedback.ID)
	}
	if second.ByTrace.FeedbackIDs["trace-1"][0] != feedback.ID {
		t.Fatalf("cached join map was mutable: got feedback ID %q, want %q", second.ByTrace.FeedbackIDs["trace-1"][0], feedback.ID)
	}
}
