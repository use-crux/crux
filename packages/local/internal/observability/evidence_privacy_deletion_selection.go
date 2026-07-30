package observability

import (
	"context"
	"database/sql"
	"fmt"
)

func collectAffectedEvidenceCoverage(
	ctx context.Context,
	tx *sql.Tx,
	deletedRuns map[string]struct{},
	plan *evidencePrivacyDeletionPlan,
) error {
	rows, err := tx.QueryContext(ctx, `
		SELECT event_id, record_id, run_id, producer_span_id,
			subject_kind, subject_id, role, status, accepted_at
		FROM evidence_coverage_events
		WHERE authorization_namespace = ?
	`, localEvidenceAuthorizationNamespace)
	if err != nil {
		return fmt.Errorf("load evidence coverage for privacy deletion: %w", err)
	}
	defer rows.Close()
	type coverageCandidate struct {
		event    expiredEvidenceCoverage
		producer evidencePrivateIdentity
	}
	candidates := make([]coverageCandidate, 0)
	for rows.Next() {
		var candidate coverageCandidate
		var producerSpanID, acceptedAt string
		if err := rows.Scan(
			&candidate.event.eventID,
			&candidate.event.recordID,
			&candidate.event.runID,
			&producerSpanID,
			&candidate.event.subjectKind,
			&candidate.event.subjectID,
			&candidate.event.role,
			&candidate.event.status,
			&acceptedAt,
		); err != nil {
			return err
		}
		candidate.producer = evidencePrivateIdentity{
			kind: "span",
			id:   producerSpanID,
		}
		candidates = append(candidates, candidate)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for _, candidate := range candidates {
		if _, deletedRun := deletedRuns[candidate.event.runID]; deletedRun {
			plan.deletedIdentities[candidate.producer] = struct{}{}
			plan.deletedIdentities[evidencePrivateIdentity{
				kind: "run",
				id:   candidate.event.runID,
			}] = struct{}{}
		}
	}
	for _, candidate := range candidates {
		event := candidate.event
		subject := evidencePrivateIdentity{
			kind: event.subjectKind,
			id:   event.subjectID,
		}
		_, deletedRun := deletedRuns[event.runID]
		if !deletedRun &&
			!plan.identityDeleted(subject) &&
			!plan.identityDeleted(candidate.producer) {
			continue
		}
		plan.coverage = append(plan.coverage, event)
	}
	return nil
}

func collectAffectedEvidenceStaging(
	ctx context.Context,
	tx *sql.Tx,
	deletedRuns map[string]struct{},
	deletedOperations map[string]struct{},
	plan *evidencePrivacyDeletionPlan,
) error {
	rows, err := tx.QueryContext(ctx, `
		SELECT evidence_id, artifact_id, run_id, operation_id
		FROM evidence_staging_candidates
		WHERE authorization_namespace = ?
	`, localEvidenceAuthorizationNamespace)
	if err != nil {
		return fmt.Errorf("load evidence staging for privacy deletion: %w", err)
	}
	defer rows.Close()
	type stagedCandidate struct {
		evidenceID  string
		artifactID  string
		runID       string
		operationID string
	}
	candidates := make([]stagedCandidate, 0)
	for rows.Next() {
		var candidate stagedCandidate
		if err := rows.Scan(
			&candidate.evidenceID,
			&candidate.artifactID,
			&candidate.runID,
			&candidate.operationID,
		); err != nil {
			return err
		}
		candidates = append(candidates, candidate)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for _, candidate := range candidates {
		_, deletedRun := deletedRuns[candidate.runID]
		_, deletedOperation := deletedOperations[candidate.operationID]
		if deletedRun || deletedOperation {
			plan.deletedIdentities[evidencePrivateIdentity{
				kind: "artifact",
				id:   candidate.artifactID,
			}] = struct{}{}
			plan.deletedIdentities[evidencePrivateIdentity{
				kind: "run",
				id:   candidate.runID,
			}] = struct{}{}
		}
	}
	for _, candidate := range candidates {
		_, deletedRun := deletedRuns[candidate.runID]
		_, deletedOperation := deletedOperations[candidate.operationID]
		_, evidenceDeleted := plan.evidenceIDs[candidate.evidenceID]
		if !deletedRun && !deletedOperation && !evidenceDeleted &&
			!plan.identityDeleted(evidencePrivateIdentity{
				kind: "artifact",
				id:   candidate.artifactID,
			}) {
			continue
		}
		plan.stagedEvidenceIDs[candidate.evidenceID] = struct{}{}
		plan.evidenceIDs[candidate.evidenceID] = struct{}{}
	}
	return nil
}
