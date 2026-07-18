package review

import (
	"context"
	"fmt"
	"strings"
)

func (s *Service) initialize(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `
CREATE TABLE IF NOT EXISTS reviews (
  review_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  revision INTEGER NOT NULL,
  latest_feedback_id TEXT NOT NULL,
  latest_payload_hash TEXT NOT NULL,
  rating TEXT NOT NULL,
  comment TEXT NOT NULL,
  correction BLOB,
  status TEXT NOT NULL,
  context_status TEXT NOT NULL,
  context_snapshot BLOB,
  target_eval_id TEXT NOT NULL DEFAULT '',
  target_case_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(run_id, dedupe_key)
);
CREATE TABLE IF NOT EXISTS feedback_submissions (
  feedback_id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  payload_hash TEXT NOT NULL,
  rating TEXT NOT NULL,
  comment TEXT NOT NULL,
  correction BLOB,
  accepted_at TEXT NOT NULL,
  UNIQUE(review_id, revision)
);
CREATE TABLE IF NOT EXISTS review_actions (
  action_id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  action_type TEXT NOT NULL,
  target_eval_id TEXT NOT NULL,
  target_case_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(review_id, sequence)
);`)
	if err != nil {
		return fmt.Errorf("initialize review database: %w", err)
	}
	for _, migration := range []string{
		`ALTER TABLE reviews ADD COLUMN target_eval_id TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE reviews ADD COLUMN target_case_id TEXT NOT NULL DEFAULT ''`,
	} {
		if _, err := s.db.ExecContext(ctx, migration); err != nil && !isDuplicateColumn(err) {
			return fmt.Errorf("migrate review database: %w", err)
		}
	}
	return nil
}

func isDuplicateColumn(err error) bool {
	return err != nil && strings.Contains(err.Error(), "duplicate column name:")
}
