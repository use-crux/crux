package observability

import (
	"context"
	"database/sql"
	"fmt"
)

// defaultRevisionLogRetention bounds the server-owned change log used for
// delta/catch-up. A reconnect older than this many revisions gets an
// explicit Expired signal instead of a silently incomplete delta.
const defaultRevisionLogRetention = 5000

// RunChange names one run whose read-model projection changed as of Revision.
// Entity is always "run" today; the field exists so the wire shape matches
// the wider `{entity, id, revision}` push contract without a breaking change
// when segment/quality/delivery-health entities publish their own deltas.
type RunChange struct {
	Entity   string `json:"entity"`
	ID       string `json:"id"`
	Revision int64  `json:"revision"`
}

// RunsDelta is the bounded catch-up response for a reconnecting client that
// presents the last revision it applied.
type RunsDelta struct {
	// Revision is the current server revision (equal to the max Changes
	// revision when Changes is non-empty).
	Revision int64 `json:"revision"`
	// Changes lists runs touched strictly after the requested revision,
	// oldest first. Empty (with Expired false) means the client is current.
	Changes []RunChange `json:"changes"`
	// Expired reports that the requested revision fell outside the bounded
	// change log; the client must fully invalidate and refetch instead of
	// trusting an empty or partial Changes list.
	Expired bool `json:"expired"`
}

// bumpRunRevisions assigns the next global revision to each run in runIDs,
// records it in the bounded change log, and returns the per-run revision
// assigned. It must run inside the same transaction as the records it
// accounts for, so a rollback undoes the revision bump along with the data.
func bumpRunRevisions(ctx context.Context, tx *sql.Tx, runIDs []string, retain int) (map[string]int64, error) {
	revisions := make(map[string]int64, len(runIDs))
	if len(runIDs) == 0 {
		return revisions, nil
	}
	for _, runID := range runIDs {
		if runID == "" {
			continue
		}
		if _, err := tx.ExecContext(ctx, `UPDATE observability_revision SET value = value + 1 WHERE id = 1`); err != nil {
			return nil, fmt.Errorf("advance observability revision counter: %w", err)
		}
		var revision int64
		if err := tx.QueryRowContext(ctx, `SELECT value FROM observability_revision WHERE id = 1`).Scan(&revision); err != nil {
			return nil, fmt.Errorf("read observability revision counter: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `UPDATE runs SET revision = ? WHERE run_id = ?`, revision, runID); err != nil {
			return nil, fmt.Errorf("persist observability run revision: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO observability_run_revision_log (revision, run_id) VALUES (?, ?)
		`, revision, runID); err != nil {
			return nil, fmt.Errorf("append observability run revision log: %w", err)
		}
		revisions[runID] = revision
	}
	if err := pruneRevisionLog(ctx, tx, retain); err != nil {
		return nil, err
	}
	return revisions, nil
}

func pruneRevisionLog(ctx context.Context, tx *sql.Tx, retain int) error {
	if retain <= 0 {
		retain = defaultRevisionLogRetention
	}
	if _, err := tx.ExecContext(ctx, `
		DELETE FROM observability_run_revision_log
		WHERE revision NOT IN (
			SELECT revision FROM observability_run_revision_log
			ORDER BY revision DESC
			LIMIT ?
		)
	`, retain); err != nil {
		return fmt.Errorf("bound observability run revision log: %w", err)
	}
	return nil
}

// CurrentRevision returns the server's current read-model revision. It is a
// single cheap query against the counter row, not a scan over runs.
func (s *Service) CurrentRevision(ctx context.Context) (int64, error) {
	ctx, cancel := s.queryContext(ctx)
	defer cancel()
	var revision int64
	if err := s.db.QueryRowContext(ctx, `SELECT value FROM observability_revision WHERE id = 1`).Scan(&revision); err != nil {
		return 0, fmt.Errorf("query observability current revision: %w", err)
	}
	return revision, nil
}

func (s *Service) revisionLogRetentionOrDefault() int {
	if s.revisionLogRetention > 0 {
		return s.revisionLogRetention
	}
	return defaultRevisionLogRetention
}

// RunsSince returns the bounded catch-up delta for a reconnecting client
// that last applied sinceRevision. When the requested revision has aged out
// of the bounded change log, it reports Expired so the caller falls back to
// a full invalidation instead of trusting an incomplete delta.
func (s *Service) RunsSince(ctx context.Context, sinceRevision int64) (RunsDelta, error) {
	ctx, cancel := s.queryContext(ctx)
	defer cancel()

	var current int64
	if err := s.db.QueryRowContext(ctx, `SELECT value FROM observability_revision WHERE id = 1`).Scan(&current); err != nil {
		return RunsDelta{}, fmt.Errorf("query observability current revision: %w", err)
	}
	if sinceRevision >= current {
		return RunsDelta{Revision: current}, nil
	}

	var oldestRetained sql.NullInt64
	if err := s.db.QueryRowContext(ctx, `SELECT min(revision) FROM observability_run_revision_log`).Scan(&oldestRetained); err != nil {
		return RunsDelta{}, fmt.Errorf("query observability revision log floor: %w", err)
	}
	if oldestRetained.Valid && sinceRevision < oldestRetained.Int64-1 {
		return RunsDelta{Revision: current, Expired: true}, nil
	}
	if !oldestRetained.Valid && sinceRevision < current {
		// No log rows retained at all (e.g. every touched run has since been
		// deleted by retention) but the counter moved: we cannot prove the
		// delta is complete, so ask for a full invalidation.
		return RunsDelta{Revision: current, Expired: true}, nil
	}

	rows, err := s.db.QueryContext(ctx, `
		SELECT revision, run_id FROM observability_run_revision_log
		WHERE revision > ?
		ORDER BY revision ASC
	`, sinceRevision)
	if err != nil {
		return RunsDelta{}, fmt.Errorf("query observability revision log delta: %w", err)
	}
	defer rows.Close()

	var changes []RunChange
	for rows.Next() {
		var revision int64
		var runID string
		if err := rows.Scan(&revision, &runID); err != nil {
			return RunsDelta{}, fmt.Errorf("scan observability revision log delta: %w", err)
		}
		changes = append(changes, RunChange{Entity: "run", ID: runID, Revision: revision})
	}
	if err := rows.Err(); err != nil {
		return RunsDelta{}, fmt.Errorf("iterate observability revision log delta: %w", err)
	}
	return RunsDelta{Revision: current, Changes: changes}, nil
}
