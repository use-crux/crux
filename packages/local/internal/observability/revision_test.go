package observability

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"
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
		if change.Entity != "operation" {
			t.Fatalf("entity = %q, want operation", change.Entity)
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

// TestDeleteRunsRecordsATombstoneRevisionInsteadOfErasingHistory locks in the
// fix for a real bug: deleteRunRows used to purge
// observability_run_revision_log rows for the deleted run, which erased the
// only durable evidence that the run ever changed. A client that had already
// applied an earlier revision and then called RunsSince (reconnect catch-up)
// would see no log rows for that run at all and get back an empty,
// non-expired delta — silently keeping the deleted run in its cache forever.
// Deletion must instead advance a fresh "tombstone" revision for the run so
// it shows up as a change, exactly like any other mutation.
func TestDeleteRunsRecordsATombstoneRevisionInsteadOfErasingHistory(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	ingestRunStart(t, service, "run_delete_tombstone", "seg_delete_tombstone", "trace_delete_tombstone", "ok", "2026-05-16T18:00:00.000Z")

	preDeleteRevision, err := service.CurrentRevision(ctx)
	if err != nil {
		t.Fatal(err)
	}

	var before int
	if err := service.db.QueryRowContext(ctx, `SELECT count(*) FROM observability_run_revision_log WHERE operation_id = ?`, "run_delete_tombstone").Scan(&before); err != nil {
		t.Fatal(err)
	}
	if before == 0 {
		t.Fatal("expected a revision log row for the ingested run")
	}

	if _, err := service.DeleteRuns(ctx, []string{"run_delete_tombstone"}); err != nil {
		t.Fatal(err)
	}

	postDeleteRevision, err := service.CurrentRevision(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if postDeleteRevision <= preDeleteRevision {
		t.Fatalf("current revision after delete = %d, want > pre-delete revision %d", postDeleteRevision, preDeleteRevision)
	}

	var after int
	if err := service.db.QueryRowContext(ctx, `SELECT count(*) FROM observability_run_revision_log WHERE operation_id = ?`, "run_delete_tombstone").Scan(&after); err != nil {
		t.Fatal(err)
	}
	if after == 0 {
		t.Fatal("revision log rows for a deleted run = 0, want at least the tombstone row deletion just recorded")
	}

	var tombstoneCount int
	if err := service.db.QueryRowContext(ctx, `SELECT count(*) FROM observability_run_revision_log WHERE operation_id = ? AND revision = ?`, "run_delete_tombstone", postDeleteRevision).Scan(&tombstoneCount); err != nil {
		t.Fatal(err)
	}
	if tombstoneCount != 1 {
		t.Fatalf("tombstone log row at revision %d = %d, want 1", postDeleteRevision, tombstoneCount)
	}
}

// TestRunsSinceReportsADeletedRunAsAChangeRequiringInvalidation is the
// behavior the tombstone revision exists to enable: a reconnecting client
// presenting a revision from before the deletion must see the deleted run
// in the bounded catch-up delta (not an empty, falsely-current delta), so
// the client-side revision-gated invalidation path (catchUpActionFromDelta
// on the DevTools side) fully invalidates instead of trusting a stale cache
// forever. See packages/devtools/ui/src/shared/lib/runs-revision.ts.
func TestRunsSinceReportsADeletedRunAsAChangeRequiringInvalidation(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	ingestRunStart(t, service, "run_delete_visible", "seg_delete_visible", "trace_delete_visible", "ok", "2026-05-16T18:00:00.000Z")

	preDeleteRevision, err := service.CurrentRevision(ctx)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := service.DeleteRuns(ctx, []string{"run_delete_visible"}); err != nil {
		t.Fatal(err)
	}

	delta, err := service.RunsSince(ctx, preDeleteRevision)
	if err != nil {
		t.Fatal(err)
	}
	if delta.Expired {
		t.Fatal("delta unexpectedly reports expired for a deletion well within the retained log window")
	}
	if len(delta.Changes) != 1 {
		t.Fatalf("delta.Changes = %#v, want exactly one change for the deleted run", delta.Changes)
	}
	if delta.Changes[0].ID != "run_delete_visible" {
		t.Fatalf("delta.Changes[0].ID = %q, want the deleted run id", delta.Changes[0].ID)
	}
}

// TestRunRetentionRecordsATombstoneRevision proves the same fix applies to
// the background age/count retention deletion path, not just the explicit
// user-facing DeleteRuns API — both call deleteRunRows and both used to
// silently erase the only evidence a run had ever existed.
func TestRunRetentionRecordsATombstoneRevision(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	// Retention's age filter excludes runs still "running" — run:start alone
	// always projects as running, so this needs an explicit terminal run:end
	// (like TestServiceDeleteRunsRemovesV2DependentTables) to be retention-eligible.
	if err := service.Ingest(ctx, mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_retention_tombstone_start","type":"run:start","runId":"run_retention_tombstone","traceId":"trace_retention_tombstone","segmentId":"seg_retention_tombstone","segmentSeq":1,"name":"retire","rootPrimitive":"agent.run","startedAt":"2020-01-01T00:00:00.000Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_retention_tombstone_end","type":"run:end","runId":"run_retention_tombstone","traceId":"trace_retention_tombstone","segmentId":"seg_retention_tombstone","segmentSeq":2,"endedAt":"2020-01-01T00:00:01.000Z","status":"ok"}`,
	)); err != nil {
		t.Fatal(err)
	}

	preRetentionRevision, err := service.CurrentRevision(ctx)
	if err != nil {
		t.Fatal(err)
	}

	deletedCount, err := service.runRetention(ctx, retentionSettings{MaxRunAge: time.Hour}, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	if deletedCount == 0 {
		t.Fatal("expected retention to delete the stale run")
	}

	postRetentionRevision, err := service.CurrentRevision(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if postRetentionRevision <= preRetentionRevision {
		t.Fatalf("current revision after retention = %d, want > pre-retention revision %d", postRetentionRevision, preRetentionRevision)
	}

	delta, err := service.RunsSince(ctx, preRetentionRevision)
	if err != nil {
		t.Fatal(err)
	}
	if len(delta.Changes) != 1 || delta.Changes[0].ID != "run_retention_tombstone" {
		t.Fatalf("delta.Changes = %#v, want exactly the retained-out run", delta.Changes)
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
