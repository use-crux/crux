package startup

import (
	"context"
	"testing"
	"time"
)

func TestJournalSnapshotAndSubscribeReplaysTypedTerminalState(t *testing.T) {
	journal := NewJournal([]TaskSpec{
		{ID: "preflight", Phase: "Checking runtime"},
		{ID: "project-index", Phase: "Indexing project"},
	})
	journal.Update("preflight", "Checking runtime", Active, nil)
	journal.Update("preflight", "Checking runtime", Degraded, []Diagnostic{{
		ID:          "runtime-host-only",
		Code:        "RUNTIME_HOST_ONLY",
		Severity:    "warning",
		Message:     "Runtime setup requires its configured host.",
		Remediation: "Generate the host handlers.",
	}})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	snapshot, revisions := journal.SnapshotAndSubscribe(ctx)
	if snapshot.Revision != 2 {
		t.Fatalf("revision = %d, want 2", snapshot.Revision)
	}
	if snapshot.Active || snapshot.Terminal {
		t.Fatalf("aggregate state = active %v terminal %v, want pending index task", snapshot.Active, snapshot.Terminal)
	}
	if len(snapshot.Diagnostics) != 1 || snapshot.Diagnostics[0].Code != "RUNTIME_HOST_ONLY" {
		t.Fatalf("diagnostics = %#v, want typed runtime-host-only diagnostic", snapshot.Diagnostics)
	}

	journal.Update("project-index", "Indexing project", Succeeded, nil)
	select {
	case next := <-revisions:
		if next.Revision <= snapshot.Revision || !next.Terminal {
			t.Fatalf("next snapshot = %#v, want newer terminal revision", next)
		}
	case <-time.After(time.Second):
		t.Fatal("subscriber did not receive newer revision")
	}
}

func TestJournalDeduplicatesDiagnosticsAndUsesFixedTaskPriority(t *testing.T) {
	journal := NewJournal([]TaskSpec{
		{ID: "preflight", Phase: "Checking runtime"},
		{ID: "project-index", Phase: "Indexing project"},
	})
	journal.Update("project-index", "Reading sources", Active, nil)
	journal.Update("preflight", "Loading runtime", Active, []Diagnostic{{ID: "same", Code: "ONE", Message: "old"}})
	journal.Update("preflight", "Loading runtime", Degraded, []Diagnostic{{ID: "same", Code: "ONE", Message: "new"}})

	snapshot, _ := journal.SnapshotAndSubscribe(context.Background())
	if snapshot.Phase != "Reading sources" {
		t.Fatalf("phase = %q, want first active task by fixed priority", snapshot.Phase)
	}
	if len(snapshot.Diagnostics) != 1 || snapshot.Diagnostics[0].Message != "new" {
		t.Fatalf("diagnostics = %#v, want one updated diagnostic", snapshot.Diagnostics)
	}
}

func TestJournalClearsRecoveredTaskDiagnosticsAndPrioritizesTasks(t *testing.T) {
	journal := NewJournal([]TaskSpec{
		{ID: "preflight", Phase: "Checking runtime"},
		{ID: "project-index", Phase: "Indexing project"},
	})
	journal.Update("project-index", "Indexing project", Degraded, []Diagnostic{{ID: "index", Code: "INDEX_FAILED"}})
	journal.Update("preflight", "Checking runtime", Degraded, []Diagnostic{{ID: "host", Code: "RUNTIME_HOST_ONLY"}})

	snapshot, _ := journal.SnapshotAndSubscribe(t.Context())
	if len(snapshot.Diagnostics) != 2 || snapshot.Diagnostics[0].Code != "RUNTIME_HOST_ONLY" {
		t.Fatalf("diagnostics = %#v, want fixed preflight-first task priority", snapshot.Diagnostics)
	}

	journal.Update("project-index", "Retrying project index", Active, nil)
	snapshot, _ = journal.SnapshotAndSubscribe(t.Context())
	if len(snapshot.Diagnostics) != 1 || snapshot.Diagnostics[0].Code != "RUNTIME_HOST_ONLY" {
		t.Fatalf("diagnostics after retry = %#v, want recovered task failure cleared", snapshot.Diagnostics)
	}
}
