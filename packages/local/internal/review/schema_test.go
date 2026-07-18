package review

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
)

func TestReviewSchemaMigratesPhase25ProjectionWithoutLosingRows(t *testing.T) {
	path := filepath.Join(t.TempDir(), "review.sqlite")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`CREATE TABLE reviews (
review_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, dedupe_key TEXT NOT NULL,
revision INTEGER NOT NULL, latest_feedback_id TEXT NOT NULL,
latest_payload_hash TEXT NOT NULL, rating TEXT NOT NULL, comment TEXT NOT NULL,
correction BLOB, status TEXT NOT NULL, context_status TEXT NOT NULL,
context_snapshot BLOB, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
UNIQUE(run_id, dedupe_key));`)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	service, err := OpenService(context.Background(), path)
	if err != nil {
		t.Fatalf("OpenService migration: %v", err)
	}
	t.Cleanup(func() { _ = service.Close() })
	receipt, err := service.Submit(context.Background(), Submission{
		RunID: "run_0123456789abcdef01234567", Rating: "up",
	}, false)
	if err != nil {
		t.Fatal(err)
	}
	projection, err := service.ApplyAction(context.Background(), Action{
		ReviewID: receipt.ReviewID, Type: "resolve",
	})
	if err != nil || projection.Status != "resolved" {
		t.Fatalf("migrated projection = %#v, err = %v", projection, err)
	}
}
