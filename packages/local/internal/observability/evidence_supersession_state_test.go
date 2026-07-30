package observability

import (
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"
)

func TestEvidenceSupersessionMigrationBackfillsLegacyPredecessors(
	t *testing.T,
) {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if _, err := db.Exec(`
		CREATE TABLE evidence_relationships (
			authorization_namespace TEXT NOT NULL,
			evidence_id TEXT NOT NULL,
			subject_kind TEXT NOT NULL,
			subject_id TEXT NOT NULL,
			role TEXT NOT NULL,
			PRIMARY KEY (authorization_namespace, evidence_id)
		);
		CREATE TABLE evidence_supersessions (
			authorization_namespace TEXT NOT NULL,
			evidence_id TEXT NOT NULL,
			superseded_evidence_id TEXT NOT NULL
		);
		INSERT INTO evidence_relationships VALUES
			('local-project', 'evidence_predecessor', 'span', 'span_subject',
			 'verification'),
			('local-project', 'evidence_successor', 'span', 'span_subject',
			 'verification');
		INSERT INTO evidence_supersessions VALUES
			('local-project', 'evidence_successor', 'evidence_predecessor');
	`); err != nil {
		t.Fatal(err)
	}
	tx, err := db.BeginTx(t.Context(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := ensureEvidenceSupersessionState(t.Context(), tx); err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}

	rows, err := db.Query(`
		SELECT evidence_id, superseded
		FROM evidence_relationships
		ORDER BY evidence_id
	`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	states := map[string]int{}
	for rows.Next() {
		var evidenceID string
		var superseded int
		if err := rows.Scan(&evidenceID, &superseded); err != nil {
			t.Fatal(err)
		}
		states[evidenceID] = superseded
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if states["evidence_predecessor"] != 1 ||
		states["evidence_successor"] != 0 {
		t.Fatalf("supersession states = %#v", states)
	}
}
