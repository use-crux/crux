package observability

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

type expiredEvidencePayload struct {
	evidenceID           string
	subjectKind          string
	subjectID            string
	sourceID             string
	runID                string
	relationshipAccepted time.Time
	payloadAccepted      time.Time
}

func (s *Service) cleanupExpiredEvidencePayloads(
	ctx context.Context,
	now time.Time,
) (err error) {
	s.mutationMu.Lock()
	defer s.mutationMu.Unlock()

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin evidence payload retention: %w", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()
	payloads, err := s.expiredEvidencePayloads(ctx, tx, now.UTC())
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
	for _, payload := range payloads {
		if err := compactEvidencePayload(
			ctx,
			statements,
			payload,
			now.UTC(),
		); err != nil {
			return err
		}
		var operationID string
		err := statements.queryRow(ctx, `
			SELECT operation_id FROM runs WHERE run_id = ?
		`, payload.runID).Scan(&operationID)
		if err != nil && err != sql.ErrNoRows {
			return fmt.Errorf("load payload compaction operation: %w", err)
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
			return fmt.Errorf("advance payload compaction revisions: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit evidence payload retention: %w", err)
	}
	committed = true
	return nil
}

func (s *Service) expiredEvidencePayloads(
	ctx context.Context,
	queryer evidenceQueryer,
	now time.Time,
) ([]expiredEvidencePayload, error) {
	payloadCutoff := now.Add(-s.evidenceSettings.PayloadRetention)
	relationshipCutoff := now.Add(
		-s.evidenceSettings.RelationshipRetention,
	)
	rows, err := queryer.QueryContext(ctx, `
		SELECT evidence_id, subject_kind, subject_id, source_id, run_id,
			relationship_accepted_at, payload_accepted_at
		FROM evidence_relationships
		WHERE authorization_namespace = ?
		  AND source_mode = 'inline'
		  AND payload_state = 'available'
		  AND payload_accepted_at IS NOT NULL
		  AND payload_expired_at IS NULL
		  AND (
			payload_accepted_at <= ?
			OR relationship_accepted_at <= ?
		  )
		ORDER BY payload_accepted_at, evidence_id
		LIMIT ?
	`, localEvidenceAuthorizationNamespace,
		formatEvidenceAcceptanceTime(payloadCutoff),
		formatEvidenceAcceptanceTime(relationshipCutoff),
		retentionDeleteBatchSize)
	if err != nil {
		return nil, fmt.Errorf("query expired evidence payloads: %w", err)
	}
	defer rows.Close()
	result := make([]expiredEvidencePayload, 0)
	for rows.Next() {
		var payload expiredEvidencePayload
		var relationshipAcceptedAt, payloadAcceptedAt string
		if err := rows.Scan(
			&payload.evidenceID,
			&payload.subjectKind,
			&payload.subjectID,
			&payload.sourceID,
			&payload.runID,
			&relationshipAcceptedAt,
			&payloadAcceptedAt,
		); err != nil {
			return nil, err
		}
		payload.relationshipAccepted, err = time.Parse(
			time.RFC3339Nano,
			relationshipAcceptedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("parse evidence relationship clock: %w", err)
		}
		payload.payloadAccepted, err = time.Parse(
			time.RFC3339Nano,
			payloadAcceptedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("parse evidence payload clock: %w", err)
		}
		payloadExpiry := payload.payloadAccepted.Add(
			s.evidenceSettings.PayloadRetention,
		)
		relationshipExpiry := payload.relationshipAccepted.Add(
			s.evidenceSettings.RelationshipRetention,
		)
		if relationshipExpiry.Before(payloadExpiry) {
			payloadExpiry = relationshipExpiry
		}
		if !payloadExpiry.After(now) {
			result = append(result, payload)
		}
	}
	return result, rows.Err()
}

func compactEvidencePayload(
	ctx context.Context,
	statements *ingestStatements,
	payload expiredEvidencePayload,
	now time.Time,
) error {
	if _, err := statements.exec(ctx, `
		UPDATE evidence_relationships
		SET payload_state = 'redacted',
			payload_json = NULL,
			payload_unavailable_reason = 'retention',
			payload_expired_at = ?
		WHERE authorization_namespace = ?
		  AND evidence_id = ?
		  AND payload_state = 'available'
		  AND payload_expired_at IS NULL
	`, now.Format(time.RFC3339Nano),
		localEvidenceAuthorizationNamespace,
		payload.evidenceID,
	); err != nil {
		return fmt.Errorf("compact evidence relationship payload: %w", err)
	}
	if _, err := statements.exec(ctx, `
		UPDATE artifacts SET preview_json = NULL
		WHERE artifact_id = ?
		  AND json_extract(
			attributes_json,
			'$.evidenceSource.evidenceId'
		  ) = ?
	`, payload.sourceID, payload.evidenceID); err != nil {
		return fmt.Errorf("compact evidence artifact preview: %w", err)
	}
	if err := compactEvidenceArtifactRecords(
		ctx,
		statements,
		payload.evidenceID,
		payload.sourceID,
	); err != nil {
		return err
	}
	return bumpEvidenceSubjectRevision(
		ctx,
		statements,
		payload.subjectKind,
		payload.subjectID,
	)
}
