package observability

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

type expiredEvidenceRelationship struct {
	evidenceID           string
	subjectKind          string
	subjectID            string
	role                 string
	sourceMode           string
	sourceID             string
	edgeID               string
	edgeRecordID         string
	runID                string
	relationshipAccepted time.Time
}

func (s *Service) cleanupExpiredEvidenceRelationships(
	ctx context.Context,
	now time.Time,
) (err error) {
	s.mutationMu.Lock()
	defer s.mutationMu.Unlock()

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin evidence relationship retention: %w", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()
	relationships, err := s.expiredEvidenceRelationships(ctx, tx, now.UTC())
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
	for _, relationship := range relationships {
		operationID, err := expireEvidenceRelationship(
			ctx,
			statements,
			relationship,
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
			return fmt.Errorf("advance evidence retention revisions: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit evidence relationship retention: %w", err)
	}
	committed = true
	return nil
}

func (s *Service) expiredEvidenceRelationships(
	ctx context.Context,
	queryer evidenceQueryer,
	now time.Time,
) ([]expiredEvidenceRelationship, error) {
	cutoff := now.Add(-s.evidenceSettings.RelationshipRetention)
	rows, err := queryer.QueryContext(ctx, `
		SELECT evidence_id, subject_kind, subject_id, role, source_mode,
			source_id, edge_id, edge_record_id, run_id,
			relationship_accepted_at
		FROM evidence_relationships
		WHERE authorization_namespace = ?
		  AND relationship_accepted_at <= ?
		ORDER BY relationship_accepted_at, evidence_id
		LIMIT ?
	`, localEvidenceAuthorizationNamespace,
		formatEvidenceAcceptanceTime(cutoff),
		retentionDeleteBatchSize)
	if err != nil {
		return nil, fmt.Errorf("query evidence relationship retention: %w", err)
	}
	defer rows.Close()
	result := make([]expiredEvidenceRelationship, 0)
	for rows.Next() {
		var relationship expiredEvidenceRelationship
		var acceptedAt string
		if err := rows.Scan(
			&relationship.evidenceID,
			&relationship.subjectKind,
			&relationship.subjectID,
			&relationship.role,
			&relationship.sourceMode,
			&relationship.sourceID,
			&relationship.edgeID,
			&relationship.edgeRecordID,
			&relationship.runID,
			&acceptedAt,
		); err != nil {
			return nil, err
		}
		relationship.relationshipAccepted, err = time.Parse(
			time.RFC3339Nano,
			acceptedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("parse evidence relationship acceptance: %w", err)
		}
		expiresAt := relationship.relationshipAccepted.Add(
			s.evidenceSettings.RelationshipRetention,
		)
		if !expiresAt.After(now) {
			result = append(result, relationship)
		}
	}
	return result, rows.Err()
}

func expireEvidenceRelationship(
	ctx context.Context,
	statements *ingestStatements,
	relationship expiredEvidenceRelationship,
	now time.Time,
) (string, error) {
	if err := markEvidenceTruncated(
		ctx,
		statements,
		relationship.subjectKind,
		relationship.subjectID,
		relationship.role,
		now,
	); err != nil {
		return "", err
	}
	if relationship.sourceMode == "inline" {
		if err := compactExpiringEvidenceArtifact(
			ctx,
			statements,
			relationship.evidenceID,
			relationship.sourceID,
		); err != nil {
			return "", err
		}
	}
	if _, err := statements.exec(
		ctx,
		`DELETE FROM edges WHERE edge_id = ?`,
		relationship.edgeID,
	); err != nil {
		return "", fmt.Errorf("delete retained evidence edge: %w", err)
	}
	if _, err := statements.exec(
		ctx,
		`DELETE FROM records WHERE record_id = ?`,
		relationship.edgeRecordID,
	); err != nil {
		return "", fmt.Errorf("delete retained evidence edge record: %w", err)
	}
	if _, err := statements.exec(ctx, `
		DELETE FROM evidence_staging_candidates
		WHERE authorization_namespace = ? AND evidence_id = ?
	`, localEvidenceAuthorizationNamespace, relationship.evidenceID); err != nil {
		return "", fmt.Errorf("delete retained evidence staging: %w", err)
	}
	if _, err := statements.exec(ctx, `
		DELETE FROM evidence_supersessions
		WHERE authorization_namespace = ?
		  AND (
			evidence_id = ?
			OR superseded_evidence_id = ?
		  )
	`, localEvidenceAuthorizationNamespace, relationship.evidenceID,
		relationship.evidenceID); err != nil {
		return "", fmt.Errorf(
			"delete retained evidence supersession indexes: %w",
			err,
		)
	}
	if _, err := statements.exec(ctx, `
		DELETE FROM evidence_reservations
		WHERE authorization_namespace = ? AND evidence_id = ?
	`, localEvidenceAuthorizationNamespace, relationship.evidenceID); err != nil {
		return "", fmt.Errorf("delete retained evidence reservation: %w", err)
	}
	if relationship.sourceMode == "inline" {
		artifactRunID, err := deleteUnreferencedEvidenceArtifact(
			ctx,
			statements,
			relationship.evidenceID,
			relationship.sourceID,
		)
		if err != nil {
			return "", err
		}
		if artifactRunID != relationship.runID {
			if err := refreshEvidenceRunStorageRollups(
				ctx,
				statements,
				artifactRunID,
			); err != nil {
				return "", err
			}
		}
	}
	if err := refreshEvidenceRunStorageRollups(
		ctx,
		statements,
		relationship.runID,
	); err != nil {
		return "", err
	}
	if err := bumpEvidenceSubjectRevision(
		ctx,
		statements,
		relationship.subjectKind,
		relationship.subjectID,
	); err != nil {
		return "", err
	}
	var operationID string
	if err := statements.queryRow(ctx, `
		SELECT operation_id FROM runs WHERE run_id = ?
	`, relationship.runID).Scan(&operationID); err != nil {
		if err == sql.ErrNoRows {
			return "", nil
		}
		return "", fmt.Errorf("load evidence retention operation: %w", err)
	}
	return operationID, nil
}
