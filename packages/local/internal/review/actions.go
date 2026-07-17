package review

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// ApplyAction appends one immutable Review action and updates its projection.
func (s *Service) ApplyAction(ctx context.Context, action Action) (Projection, error) {
	status, err := actionStatus(action)
	if err != nil {
		return Projection{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Projection{}, err
	}
	defer func() { _ = tx.Rollback() }()

	var currentStatus, currentEvalID, currentCaseID string
	var sequence int
	err = tx.QueryRowContext(ctx, `
SELECT status, target_eval_id, target_case_id,
 (SELECT COUNT(*) FROM review_actions WHERE review_id = reviews.review_id)
FROM reviews WHERE review_id = ?`, action.ReviewID).
		Scan(&currentStatus, &currentEvalID, &currentCaseID, &sequence)
	if errors.Is(err, sql.ErrNoRows) {
		return Projection{}, ErrNotFound
	}
	if err != nil {
		return Projection{}, err
	}
	if currentStatus != "open" {
		if currentStatus != status || currentEvalID != action.TargetEvalID || currentCaseID != action.TargetCaseID {
			return Projection{}, invalid("Review is already finalized and cannot be reopened in V1")
		}
		if err := tx.Commit(); err != nil {
			return Projection{}, err
		}
		projection, _, err := s.Review(ctx, action.ReviewID)
		return projection, err
	}

	actionID, err := randomID("action")
	if err != nil {
		return Projection{}, err
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	sequence++
	_, err = tx.ExecContext(ctx, `
INSERT INTO review_actions(action_id, review_id, sequence, action_type,
 target_eval_id, target_case_id, created_at) VALUES(?, ?, ?, ?, ?, ?, ?)`,
		actionID, action.ReviewID, sequence, action.Type, action.TargetEvalID, action.TargetCaseID, now)
	if err != nil {
		return Projection{}, err
	}
	_, err = tx.ExecContext(ctx, `
UPDATE reviews SET status = ?, target_eval_id = ?, target_case_id = ?, updated_at = ?
WHERE review_id = ?`, status, action.TargetEvalID, action.TargetCaseID, now, action.ReviewID)
	if err != nil {
		return Projection{}, err
	}
	if err := tx.Commit(); err != nil {
		return Projection{}, err
	}
	projection, _, err := s.Review(ctx, action.ReviewID)
	return projection, err
}

// Actions returns immutable action history in append order.
func (s *Service) Actions(ctx context.Context, reviewID string) ([]ActionRecord, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT action_id, review_id, sequence, action_type, target_eval_id, target_case_id, created_at
FROM review_actions WHERE review_id = ? ORDER BY sequence`, reviewID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var actions []ActionRecord
	for rows.Next() {
		var action ActionRecord
		if err := rows.Scan(&action.ActionID, &action.ReviewID, &action.Sequence,
			&action.Type, &action.TargetEvalID, &action.TargetCaseID, &action.CreatedAt); err != nil {
			return nil, err
		}
		actions = append(actions, action)
	}
	return actions, rows.Err()
}

func actionStatus(action Action) (string, error) {
	if action.ReviewID == "" {
		return "", invalid("reviewId is required")
	}
	switch action.Type {
	case "resolve":
		if action.TargetEvalID != "" || action.TargetCaseID != "" {
			return "", invalid("resolve does not accept an Eval or Case target")
		}
		return "resolved", nil
	case "dismiss":
		if action.TargetEvalID != "" || action.TargetCaseID != "" {
			return "", invalid("dismiss does not accept an Eval or Case target")
		}
		return "dismissed", nil
	case "added-to-eval":
		if action.TargetEvalID == "" || action.TargetCaseID == "" {
			return "", invalid("added-to-eval requires targetEvalId and targetCaseId")
		}
		return "added-to-eval", nil
	default:
		return "", invalid("Review action must be resolve, dismiss, or added-to-eval")
	}
}
