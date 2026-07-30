package observability

import (
	"context"
	"database/sql"
	"fmt"
)

type evidenceSubjectRole struct {
	subject evidencePrivateIdentity
	role    string
}

func (s *Service) deleteEvidenceForExplicitRunDeletion(
	ctx context.Context,
	tx *sql.Tx,
	deletedOperationIDs []string,
	deletedRunIDs []string,
) (affectedOperationIDs []string, err error) {
	plan, err := planEvidencePrivacyDeletion(
		ctx,
		tx,
		deletedOperationIDs,
		deletedRunIDs,
	)
	if err != nil {
		return nil, err
	}
	statements := newIngestStatements(tx)
	defer func() {
		if closeErr := statements.close(); closeErr != nil && err == nil {
			err = closeErr
		}
	}()
	deletedAt := formatEvidenceAcceptanceTime(s.evidenceNow())
	for identity := range plan.deletedIdentities {
		if err := insertEvidencePrivacyTombstone(
			ctx,
			statements,
			identity,
			deletedAt,
		); err != nil {
			return nil, err
		}
	}
	for evidenceID := range plan.evidenceIDs {
		if err := insertEvidencePrivacyTombstone(
			ctx,
			statements,
			evidencePrivateIdentity{kind: "evidence", id: evidenceID},
			deletedAt,
		); err != nil {
			return nil, err
		}
	}
	for identity := range plan.approvalTombstones {
		if err := insertEvidencePrivacyTombstone(
			ctx,
			statements,
			identity,
			deletedAt,
		); err != nil {
			return nil, err
		}
	}

	watermarks := make(map[evidenceSubjectRole]struct{})
	revisedSubjects := make(map[evidencePrivateIdentity]struct{})
	affectedRunIDs := make(map[string]struct{})
	for _, relationship := range plan.relationships {
		if !plan.identityDeleted(relationship.subject) {
			watermarks[evidenceSubjectRole{
				subject: relationship.subject,
				role:    relationship.role,
			}] = struct{}{}
			revisedSubjects[relationship.subject] = struct{}{}
		}
		artifactRunID, err := deletePrivateEvidenceRelationship(
			ctx,
			statements,
			relationship,
		)
		if err != nil {
			return nil, err
		}
		affectedRunIDs[relationship.runID] = struct{}{}
		if artifactRunID != "" {
			affectedRunIDs[artifactRunID] = struct{}{}
		}
	}
	for _, event := range plan.coverage {
		projectionChanged, err := deletePrivateEvidenceCoverage(
			ctx,
			statements,
			event,
		)
		if err != nil {
			return nil, err
		}
		subject := evidencePrivateIdentity{
			kind: event.subjectKind,
			id:   event.subjectID,
		}
		if projectionChanged && !plan.identityDeleted(subject) {
			watermarks[evidenceSubjectRole{
				subject: subject,
				role:    event.role,
			}] = struct{}{}
			revisedSubjects[subject] = struct{}{}
		}
		affectedRunIDs[event.runID] = struct{}{}
	}
	for evidenceID := range plan.stagedEvidenceIDs {
		if _, err := statements.exec(ctx, `
			DELETE FROM evidence_staging_candidates
			WHERE authorization_namespace = ? AND evidence_id = ?
		`, localEvidenceAuthorizationNamespace, evidenceID); err != nil {
			return nil, fmt.Errorf("delete private evidence staging: %w", err)
		}
	}
	for _, artifact := range plan.approvalArtifacts {
		if err := deletePrivateApprovalArtifact(
			ctx,
			statements,
			artifact,
		); err != nil {
			return nil, err
		}
		affectedRunIDs[artifact.runID] = struct{}{}
	}
	now := s.evidenceNow().UTC()
	for key := range watermarks {
		if err := markEvidenceTruncated(
			ctx,
			statements,
			key.subject.kind,
			key.subject.id,
			key.role,
			now,
		); err != nil {
			return nil, err
		}
	}
	for subject := range revisedSubjects {
		if err := bumpEvidenceSubjectRevision(
			ctx,
			statements,
			subject.kind,
			subject.id,
		); err != nil {
			return nil, err
		}
	}
	if err := removeDeletedEvidenceSubjectState(
		ctx,
		statements,
		plan.deletedIdentities,
	); err != nil {
		return nil, err
	}
	for runID := range affectedRunIDs {
		if err := refreshEvidenceRunStorageRollups(
			ctx,
			statements,
			runID,
		); err != nil {
			return nil, err
		}
	}
	return evidenceOperationIDsForRuns(ctx, tx, affectedRunIDs)
}

func evidenceOperationIDsForRuns(
	ctx context.Context,
	tx *sql.Tx,
	runIDs map[string]struct{},
) ([]string, error) {
	if len(runIDs) == 0 {
		return nil, nil
	}
	ids := make([]string, 0, len(runIDs))
	for id := range runIDs {
		ids = append(ids, id)
	}
	rows, err := tx.QueryContext(ctx, `
		SELECT DISTINCT operation_id FROM runs
		WHERE run_id IN (`+queryPlaceholders(len(ids))+`)
	`, queryArgs(ids)...)
	if err != nil {
		return nil, fmt.Errorf("load privacy deletion operations: %w", err)
	}
	defer rows.Close()
	result := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		result = append(result, id)
	}
	return result, rows.Err()
}
