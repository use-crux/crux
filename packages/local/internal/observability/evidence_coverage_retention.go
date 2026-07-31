package observability

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

type expiredEvidenceCoverage struct {
	eventID     string
	recordID    string
	runID       string
	subjectKind string
	subjectID   string
	role        string
	status      string
	acceptedAt  time.Time
}

func (s *Service) cleanupExpiredEvidenceCoverage(
	ctx context.Context,
	now time.Time,
) (err error) {
	s.mutationMu.Lock()
	defer s.mutationMu.Unlock()

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin evidence coverage retention: %w", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()
	events, err := s.expiredEvidenceCoverageEvents(ctx, tx, now.UTC())
	if err != nil {
		return err
	}
	statements := newIngestStatements(tx)
	defer func() {
		if closeErr := statements.close(); closeErr != nil && err == nil {
			err = closeErr
		}
	}()
	operationIDs := make(map[string]struct{})
	for _, event := range events {
		operationID, err := expireEvidenceCoverageEvent(
			ctx,
			statements,
			event,
			now.UTC(),
		)
		if err != nil {
			return err
		}
		if operationID != "" {
			operationIDs[operationID] = struct{}{}
		}
	}
	if len(operationIDs) > 0 {
		ids := make([]string, 0, len(operationIDs))
		for operationID := range operationIDs {
			ids = append(ids, operationID)
		}
		if _, err := bumpRunRevisions(
			ctx,
			tx,
			ids,
			s.revisionLogRetentionOrDefault(),
		); err != nil {
			return fmt.Errorf("advance coverage retention revisions: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit evidence coverage retention: %w", err)
	}
	committed = true
	return nil
}

func (s *Service) expiredEvidenceCoverageEvents(
	ctx context.Context,
	queryer evidenceQueryer,
	now time.Time,
) ([]expiredEvidenceCoverage, error) {
	cutoff := now.Add(-s.evidenceSettings.RelationshipRetention)
	rows, err := queryer.QueryContext(ctx, `
		SELECT event_id, record_id, run_id, subject_kind, subject_id,
			role, status, accepted_at
		FROM evidence_coverage_events
		WHERE authorization_namespace = ?
		  AND accepted_at <= ?
		ORDER BY accepted_at, event_id
		LIMIT ?
	`, localEvidenceAuthorizationNamespace,
		formatEvidenceAcceptanceTime(cutoff),
		retentionDeleteBatchSize)
	if err != nil {
		return nil, fmt.Errorf("query evidence coverage retention: %w", err)
	}
	defer rows.Close()
	result := make([]expiredEvidenceCoverage, 0)
	for rows.Next() {
		var event expiredEvidenceCoverage
		var acceptedAt string
		if err := rows.Scan(
			&event.eventID,
			&event.recordID,
			&event.runID,
			&event.subjectKind,
			&event.subjectID,
			&event.role,
			&event.status,
			&acceptedAt,
		); err != nil {
			return nil, err
		}
		event.acceptedAt, err = time.Parse(time.RFC3339Nano, acceptedAt)
		if err != nil {
			return nil, fmt.Errorf(
				"parse evidence coverage acceptance: %w",
				err,
			)
		}
		result = append(result, event)
	}
	return result, rows.Err()
}

func expireEvidenceCoverageEvent(
	ctx context.Context,
	statements *ingestStatements,
	event expiredEvidenceCoverage,
	now time.Time,
) (string, error) {
	if _, err := statements.exec(ctx, `
		DELETE FROM evidence_coverage_events
		WHERE authorization_namespace = ? AND event_id = ?
	`, localEvidenceAuthorizationNamespace, event.eventID); err != nil {
		return "", fmt.Errorf("delete retained evidence coverage event: %w", err)
	}
	var supports int
	err := statements.queryRow(ctx, `
		SELECT support_count FROM evidence_coverage_projection
		WHERE authorization_namespace = ? AND subject_kind = ?
		  AND subject_id = ? AND role = ? AND status = ?
	`, localEvidenceAuthorizationNamespace, event.subjectKind, event.subjectID,
		event.role, event.status).Scan(&supports)
	if err != nil && err != sql.ErrNoRows {
		return "", fmt.Errorf("load evidence coverage support: %w", err)
	}
	if supports > 1 {
		if _, err := statements.exec(ctx, `
			UPDATE evidence_coverage_projection
			SET support_count = support_count - 1
			WHERE authorization_namespace = ? AND subject_kind = ?
			  AND subject_id = ? AND role = ? AND status = ?
		`, localEvidenceAuthorizationNamespace, event.subjectKind,
			event.subjectID, event.role, event.status); err != nil {
			return "", fmt.Errorf("decrement evidence coverage support: %w", err)
		}
	} else if supports == 1 {
		if _, err := statements.exec(ctx, `
			DELETE FROM evidence_coverage_projection
			WHERE authorization_namespace = ? AND subject_kind = ?
			  AND subject_id = ? AND role = ? AND status = ?
		`, localEvidenceAuthorizationNamespace, event.subjectKind,
			event.subjectID, event.role, event.status); err != nil {
			return "", fmt.Errorf("remove evidence coverage status: %w", err)
		}
		if err := markEvidenceTruncated(
			ctx,
			statements,
			event.subjectKind,
			event.subjectID,
			event.role,
			now,
		); err != nil {
			return "", err
		}
	}
	if _, err := statements.exec(
		ctx,
		`DELETE FROM span_events WHERE event_id = ?`,
		event.eventID,
	); err != nil {
		return "", fmt.Errorf("delete retained coverage span event: %w", err)
	}
	if _, err := statements.exec(
		ctx,
		`DELETE FROM records WHERE record_id = ?`,
		event.recordID,
	); err != nil {
		return "", fmt.Errorf("delete retained coverage raw record: %w", err)
	}
	if err := bumpEvidenceSubjectRevision(
		ctx,
		statements,
		event.subjectKind,
		event.subjectID,
	); err != nil {
		return "", err
	}
	if err := refreshEvidenceRunStorageRollups(
		ctx,
		statements,
		event.runID,
	); err != nil {
		return "", err
	}
	var operationID string
	err = statements.queryRow(ctx, `
		SELECT operation_id FROM runs WHERE run_id = ?
	`, event.runID).Scan(&operationID)
	if err == sql.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("load coverage retention operation: %w", err)
	}
	return operationID, nil
}

func markEvidenceTruncated(
	ctx context.Context,
	statements *ingestStatements,
	subjectKind string,
	subjectID string,
	role string,
	now time.Time,
) error {
	if _, err := statements.exec(ctx, `
		INSERT INTO evidence_truncation_watermarks (
			authorization_namespace, subject_kind, subject_id, role,
			truncated_at
		) VALUES (?, ?, ?, ?, ?)
		ON CONFLICT (
			authorization_namespace, subject_kind, subject_id, role
		) DO UPDATE SET truncated_at = excluded.truncated_at
	`, localEvidenceAuthorizationNamespace, subjectKind, subjectID, role,
		now.UTC().Format(time.RFC3339Nano)); err != nil {
		return fmt.Errorf("write evidence truncation watermark: %w", err)
	}
	return nil
}
