package observability

import (
	"context"
	"errors"
	"fmt"
	"testing"
)

func TestRunsSinceReturnsBoundedCatchUpDelta(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)

	base, err := service.CurrentRevision(ctx)
	if err != nil {
		t.Fatal(err)
	}
	ingestRunStart(t, service, "run_delta_a", "seg_delta_a", "trace_delta_a", "ok", "2026-05-16T18:00:00.000Z")
	ingestRunStart(t, service, "run_delta_b", "seg_delta_b", "trace_delta_b", "ok", "2026-05-16T18:01:00.000Z")

	delta, err := service.RunsSince(ctx, base)
	if err != nil {
		t.Fatal(err)
	}
	if delta.Expired {
		t.Fatal("delta unexpectedly reported the catch-up window as expired")
	}
	if len(delta.Changes) != 2 {
		t.Fatalf("changes = %#v, want 2", delta.Changes)
	}
	seen := map[string]bool{}
	for _, change := range delta.Changes {
		if change.Entity != "run" {
			t.Fatalf("entity = %q, want run", change.Entity)
		}
		if change.Revision <= base {
			t.Fatalf("change revision %d did not advance past base %d", change.Revision, base)
		}
		seen[change.ID] = true
	}
	if !seen["run_delta_a"] || !seen["run_delta_b"] {
		t.Fatalf("changes = %#v, missing expected run ids", delta.Changes)
	}
	if delta.Revision != seen2Max(delta) {
		t.Fatalf("delta.Revision = %d, want the max reported change revision", delta.Revision)
	}
}

func seen2Max(delta RunsDelta) int64 {
	var max int64
	for _, change := range delta.Changes {
		if change.Revision > max {
			max = change.Revision
		}
	}
	return max
}

func TestRunsSinceReportsExpiredCatchUpBeyondTheBoundedWindow(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	service.revisionLogRetention = 3

	base, err := service.CurrentRevision(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 6; i++ {
		runID := fmt.Sprintf("run_expire_%d", i)
		ingestRunStart(t, service, runID, "seg_"+runID, "trace_"+runID, "ok", fmt.Sprintf("2026-05-16T18:0%d:00.000Z", i))
	}

	delta, err := service.RunsSince(ctx, base)
	if err != nil {
		t.Fatal(err)
	}
	if !delta.Expired {
		t.Fatal("expected catch-up beyond the bounded log window to report Expired")
	}
	if len(delta.Changes) != 0 {
		t.Fatalf("expired delta should not report a partial change list, got %#v", delta.Changes)
	}
}

func TestRunsSinceAtCurrentRevisionReturnsNoChanges(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	ingestRunStart(t, service, "run_delta_current", "seg_delta_current", "trace_delta_current", "ok", "2026-05-16T18:00:00.000Z")

	current, err := service.CurrentRevision(ctx)
	if err != nil {
		t.Fatal(err)
	}
	delta, err := service.RunsSince(ctx, current)
	if err != nil {
		t.Fatal(err)
	}
	if delta.Expired || len(delta.Changes) != 0 {
		t.Fatalf("delta = %#v, want no changes at current revision", delta)
	}
}

func TestRetentionDeletesRevisionLogRowsForDeletedRuns(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	ingestRunStart(t, service, "run_retention_rev", "seg_retention_rev", "trace_retention_rev", "ok", "2026-05-16T18:00:00.000Z")

	var before int
	if err := service.db.QueryRowContext(ctx, `SELECT count(*) FROM observability_run_revision_log WHERE run_id = ?`, "run_retention_rev").Scan(&before); err != nil {
		t.Fatal(err)
	}
	if before == 0 {
		t.Fatal("expected a revision log row for the ingested run")
	}

	if _, err := service.DeleteRuns(ctx, []string{"run_retention_rev"}); err != nil {
		t.Fatal(err)
	}

	var after int
	if err := service.db.QueryRowContext(ctx, `SELECT count(*) FROM observability_run_revision_log WHERE run_id = ?`, "run_retention_rev").Scan(&after); err != nil {
		t.Fatal(err)
	}
	if after != 0 {
		t.Fatalf("revision log rows for a deleted run = %d, want 0", after)
	}
}

func TestCurrentRevisionErrorsPropagateFromClosedDatabase(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	if err := service.db.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := service.CurrentRevision(ctx); err == nil {
		t.Fatal("expected an error from a closed database")
	} else if errors.Is(err, ErrNotFound) {
		t.Fatalf("unexpected not-found error: %v", err)
	}
}
