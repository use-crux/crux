package observability

import (
	"context"
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"
)

// TestServiceAddsRevisionColumnToAnExistingV2DatabaseWithoutResetting proves
// the forward-only migration for a pre-Phase-11 v2 database: existing run
// rows must survive, gain a queryable revision column, and continue ingesting
// without a full observability table reset.
func TestServiceAddsRevisionColumnToAnExistingV2DatabaseWithoutResetting(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })

	preMigration, err := NewService(db)
	if err != nil {
		t.Fatal(err)
	}
	if err := preMigration.Ingest(ctx, mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_pre_revision","type":"run:start","runId":"run_pre_revision","segmentId":"seg_pre_revision","segmentSeq":1,"traceId":"trace_pre_revision","name":"pre revision","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
	)); err != nil {
		t.Fatal(err)
	}

	// Simulate a pre-Phase-11 v2 database by dropping the columns/tables this
	// phase introduces, as if the binary had never run this migration.
	if _, err := db.ExecContext(ctx, `DROP TABLE IF EXISTS observability_revision`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `DROP TABLE IF EXISTS observability_run_revision_log`); err != nil {
		t.Fatal(err)
	}

	reopened, err := NewService(db)
	if err != nil {
		t.Fatal(err)
	}

	run, err := reopened.Run(ctx, "run_pre_revision")
	if err != nil {
		t.Fatalf("pre-existing run lost across migration: %v", err)
	}
	if run.RunID != "run_pre_revision" {
		t.Fatalf("run = %#v, want the pre-existing run preserved", run)
	}

	if err := reopened.Ingest(ctx, mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_post_revision","type":"run:start","runId":"run_post_revision","segmentId":"seg_post_revision","segmentSeq":1,"traceId":"trace_post_revision","name":"post revision","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:01:00.000Z","status":"running"}`,
	)); err != nil {
		t.Fatalf("ingest failed after revision migration: %v", err)
	}
	page, err := reopened.RunsPage(ctx, RunListOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if page.Revision == 0 {
		t.Fatal("revision counter did not resume tracking after migration")
	}
}
