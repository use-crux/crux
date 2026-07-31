package observability

import (
	"context"
	"database/sql"
	"fmt"
)

func deletePrivateEvidenceRelationship(
	ctx context.Context,
	statements *ingestStatements,
	relationship evidencePrivacyRelationship,
) (string, error) {
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
		return "", fmt.Errorf("delete private evidence edge: %w", err)
	}
	if _, err := statements.exec(
		ctx,
		`DELETE FROM records WHERE record_id = ?`,
		relationship.recordID,
	); err != nil {
		return "", fmt.Errorf("delete private evidence edge record: %w", err)
	}
	if _, err := statements.exec(ctx, `
		DELETE FROM evidence_staging_candidates
		WHERE authorization_namespace = ? AND evidence_id = ?
	`, localEvidenceAuthorizationNamespace, relationship.evidenceID); err != nil {
		return "", fmt.Errorf("delete private evidence staging: %w", err)
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
		return "", fmt.Errorf("delete private evidence history index: %w", err)
	}
	if _, err := statements.exec(ctx, `
		DELETE FROM evidence_reservations
		WHERE authorization_namespace = ? AND evidence_id = ?
	`, localEvidenceAuthorizationNamespace, relationship.evidenceID); err != nil {
		return "", fmt.Errorf("delete private evidence reservation: %w", err)
	}
	if relationship.sourceMode != "inline" {
		return "", nil
	}
	return deleteUnreferencedEvidenceArtifact(
		ctx,
		statements,
		relationship.evidenceID,
		relationship.sourceID,
	)
}

func deletePrivateEvidenceCoverage(
	ctx context.Context,
	statements *ingestStatements,
	event expiredEvidenceCoverage,
) (bool, error) {
	if _, err := statements.exec(ctx, `
		DELETE FROM evidence_coverage_events
		WHERE authorization_namespace = ? AND event_id = ?
	`, localEvidenceAuthorizationNamespace, event.eventID); err != nil {
		return false, fmt.Errorf("delete private evidence coverage: %w", err)
	}
	var supports int
	err := statements.queryRow(ctx, `
		SELECT support_count FROM evidence_coverage_projection
		WHERE authorization_namespace = ? AND subject_kind = ?
		  AND subject_id = ? AND role = ? AND status = ?
	`, localEvidenceAuthorizationNamespace, event.subjectKind, event.subjectID,
		event.role, event.status).Scan(&supports)
	if err != nil && err != sql.ErrNoRows {
		return false, fmt.Errorf("load private evidence coverage support: %w", err)
	}
	projectionChanged := supports == 1
	if supports > 1 {
		if _, err := statements.exec(ctx, `
			UPDATE evidence_coverage_projection
			SET support_count = support_count - 1
			WHERE authorization_namespace = ? AND subject_kind = ?
			  AND subject_id = ? AND role = ? AND status = ?
		`, localEvidenceAuthorizationNamespace, event.subjectKind,
			event.subjectID, event.role, event.status); err != nil {
			return false, fmt.Errorf("decrement private evidence coverage: %w", err)
		}
	} else if supports == 1 {
		if _, err := statements.exec(ctx, `
			DELETE FROM evidence_coverage_projection
			WHERE authorization_namespace = ? AND subject_kind = ?
			  AND subject_id = ? AND role = ? AND status = ?
		`, localEvidenceAuthorizationNamespace, event.subjectKind,
			event.subjectID, event.role, event.status); err != nil {
			return false, fmt.Errorf("remove private evidence coverage: %w", err)
		}
	}
	if _, err := statements.exec(
		ctx,
		`DELETE FROM span_events WHERE event_id = ?`,
		event.eventID,
	); err != nil {
		return false, fmt.Errorf("delete private coverage event: %w", err)
	}
	if _, err := statements.exec(
		ctx,
		`DELETE FROM records WHERE record_id = ?`,
		event.recordID,
	); err != nil {
		return false, fmt.Errorf("delete private coverage record: %w", err)
	}
	return projectionChanged, nil
}

func removeDeletedEvidenceSubjectState(
	ctx context.Context,
	statements *ingestStatements,
	identities map[evidencePrivateIdentity]struct{},
) error {
	for identity := range identities {
		switch identity.kind {
		case "run", "span", "artifact":
		default:
			continue
		}
		for _, table := range []string{
			"evidence_coverage_projection",
			"evidence_subject_revisions",
			"evidence_truncation_watermarks",
		} {
			if _, err := statements.exec(
				ctx,
				"DELETE FROM "+table+
					" WHERE authorization_namespace = ?"+
					" AND subject_kind = ? AND subject_id = ?",
				localEvidenceAuthorizationNamespace,
				identity.kind,
				identity.id,
			); err != nil {
				return fmt.Errorf("delete private evidence subject state: %w", err)
			}
		}
	}
	return nil
}
