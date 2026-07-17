package review

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

var ErrNotFound = errors.New("review not found")

type Service struct {
	db *sql.DB
}

func OpenService(ctx context.Context, path string) (*Service, error) {
	if path != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			return nil, fmt.Errorf("create review directory: %w", err)
		}
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open review database: %w", err)
	}
	db.SetMaxOpenConns(1)
	service := &Service{db: db}
	if err := service.initialize(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}
	return service, nil
}

func (s *Service) Close() error { return s.db.Close() }

func (s *Service) Submit(ctx context.Context, raw Submission, runExists bool) (Receipt, error) {
	input, err := normalizeSubmission(raw)
	if err != nil {
		return Receipt{}, err
	}
	payload, _ := json.Marshal(input)
	payloadHash := fmt.Sprintf("%x", sha256.Sum256(payload))
	dedupeKey := input.DedupeKey
	if dedupeKey == "" {
		dedupeKey = "rating"
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Receipt{}, err
	}
	defer func() { _ = tx.Rollback() }()

	var reviewID, latestFeedbackID, latestHash, acceptedAt string
	var revision int
	err = tx.QueryRowContext(ctx, `
SELECT review_id, revision, latest_feedback_id, latest_payload_hash,
       (SELECT accepted_at FROM feedback_submissions WHERE feedback_id = latest_feedback_id)
FROM reviews WHERE run_id = ? AND dedupe_key = ?`, input.RunID, dedupeKey).
		Scan(&reviewID, &revision, &latestFeedbackID, &latestHash, &acceptedAt)
	if err == nil && latestHash == payloadHash {
		if err := tx.Commit(); err != nil {
			return Receipt{}, err
		}
		return Receipt{FeedbackID: latestFeedbackID, ReviewID: reviewID, Revision: revision, Status: "duplicate", AcceptedAt: acceptedAt}, nil
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return Receipt{}, err
	}

	now := time.Now().UTC().Format(time.RFC3339Nano)
	feedbackID, err := randomID("feedback")
	if err != nil {
		return Receipt{}, err
	}
	status := "updated"
	if reviewID == "" {
		reviewID, err = randomID("review")
		if err != nil {
			return Receipt{}, err
		}
		revision = 1
		status = "created"
		contextStatus := "pending"
		if runExists {
			contextStatus = "linked"
		}
		_, err = tx.ExecContext(ctx, `
INSERT INTO reviews(review_id, run_id, dedupe_key, revision, latest_feedback_id,
 latest_payload_hash, rating, comment, correction, status, context_status, created_at, updated_at)
VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
			reviewID, input.RunID, dedupeKey, revision, feedbackID, payloadHash,
			input.Rating, input.Comment, nullableBytes(input.Correction), contextStatus, now, now)
	} else {
		revision++
		_, err = tx.ExecContext(ctx, `
UPDATE reviews SET revision = ?, latest_feedback_id = ?, latest_payload_hash = ?,
 rating = ?, comment = ?, correction = ?, updated_at = ? WHERE review_id = ?`,
			revision, feedbackID, payloadHash, input.Rating, input.Comment,
			nullableBytes(input.Correction), now, reviewID)
	}
	if err != nil {
		return Receipt{}, err
	}
	_, err = tx.ExecContext(ctx, `
INSERT INTO feedback_submissions(feedback_id, review_id, revision, payload_hash,
 rating, comment, correction, accepted_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
		feedbackID, reviewID, revision, payloadHash, input.Rating, input.Comment,
		nullableBytes(input.Correction), now)
	if err != nil {
		return Receipt{}, err
	}
	if err := tx.Commit(); err != nil {
		return Receipt{}, err
	}
	return Receipt{FeedbackID: feedbackID, ReviewID: reviewID, Revision: revision, Status: status, AcceptedAt: now}, nil
}

func (s *Service) LinkRunContext(ctx context.Context, snapshot ContextSnapshot) error {
	if !runIDPattern.MatchString(snapshot.RunID) {
		return invalid("runId must be a valid Crux run ID")
	}
	encoded, err := json.Marshal(snapshot)
	if err != nil || len(encoded) > 16*1_024 {
		return errors.New("review context snapshot is invalid")
	}
	_, err = s.db.ExecContext(ctx, `UPDATE reviews SET context_status = 'linked', context_snapshot = ?, updated_at = ? WHERE run_id = ?`, encoded, time.Now().UTC().Format(time.RFC3339Nano), snapshot.RunID)
	return err
}

func (s *Service) ReconcileRun(ctx context.Context, runID string) error {
	return s.LinkRunContext(ctx, ContextSnapshot{RunID: runID})
}

func (s *Service) Review(ctx context.Context, reviewID string) (Projection, []SubmissionRecord, error) {
	var projection Projection
	var correction []byte
	var contextSnapshot []byte
	err := s.db.QueryRowContext(ctx, `
SELECT review_id, run_id, status, rating, comment, correction, revision,
 context_status, context_snapshot, target_eval_id, target_case_id, created_at, updated_at
 FROM reviews WHERE review_id = ?`, reviewID).
		Scan(&projection.ReviewID, &projection.RunID, &projection.Status, &projection.Rating,
			&projection.Comment, &correction, &projection.Revision, &projection.ContextStatus,
			&contextSnapshot, &projection.TargetEvalID, &projection.TargetCaseID,
			&projection.CreatedAt, &projection.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Projection{}, nil, ErrNotFound
	}
	if err != nil {
		return Projection{}, nil, err
	}
	projection.Correction = correction
	projection.Context = contextSnapshot
	rows, err := s.db.QueryContext(ctx, `
SELECT feedback_id, review_id, revision, rating, comment, correction, accepted_at
FROM feedback_submissions WHERE review_id = ? ORDER BY revision`, reviewID)
	if err != nil {
		return Projection{}, nil, err
	}
	defer rows.Close()
	var history []SubmissionRecord
	for rows.Next() {
		var record SubmissionRecord
		var rawCorrection []byte
		if err := rows.Scan(&record.FeedbackID, &record.ReviewID, &record.Revision,
			&record.Rating, &record.Comment, &rawCorrection, &record.AcceptedAt); err != nil {
			return Projection{}, nil, err
		}
		record.Correction = rawCorrection
		history = append(history, record)
	}
	return projection, history, rows.Err()
}

func randomID(prefix string) (string, error) {
	value := make([]byte, 12)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return prefix + "_" + hex.EncodeToString(value), nil
}

func nullableBytes(value []byte) any {
	if len(value) == 0 {
		return nil
	}
	return value
}
