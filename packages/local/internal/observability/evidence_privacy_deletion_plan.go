package observability

import (
	"context"
	"database/sql"
	"fmt"
)

type evidencePrivacyDeletionPlan struct {
	deletedIdentities  map[evidencePrivateIdentity]struct{}
	evidenceIDs        map[string]struct{}
	relationships      []evidencePrivacyRelationship
	coverage           []expiredEvidenceCoverage
	stagedEvidenceIDs  map[string]struct{}
	approvalArtifacts  []approvalPrivacyArtifact
	approvalTombstones map[evidencePrivateIdentity]struct{}
}

type evidencePrivacyRelationship struct {
	evidenceID string
	subject    evidencePrivateIdentity
	role       string
	sourceMode string
	sourceKind string
	sourceID   string
	producer   evidencePrivateIdentity
	runID      string
	edgeID     string
	recordID   string
}

type approvalPrivacyArtifact struct {
	artifactID string
	recordID   string
	runID      string
}

func planEvidencePrivacyDeletion(
	ctx context.Context,
	tx *sql.Tx,
	deletedOperationIDs []string,
	deletedRunIDs []string,
) (evidencePrivacyDeletionPlan, error) {
	plan := evidencePrivacyDeletionPlan{
		deletedIdentities:  make(map[evidencePrivateIdentity]struct{}),
		evidenceIDs:        make(map[string]struct{}),
		stagedEvidenceIDs:  make(map[string]struct{}),
		approvalTombstones: make(map[evidencePrivateIdentity]struct{}),
	}
	runSet := stringSliceSet(deletedRunIDs)
	operationSet := stringSliceSet(deletedOperationIDs)
	for _, runID := range deletedRunIDs {
		plan.deletedIdentities[evidencePrivateIdentity{
			kind: "run",
			id:   runID,
		}] = struct{}{}
	}
	if err := collectDeletedExecutionIdentities(
		ctx,
		tx,
		deletedRunIDs,
		plan.deletedIdentities,
	); err != nil {
		return plan, err
	}
	if err := collectAffectedApprovalArtifacts(
		ctx,
		tx,
		runSet,
		operationSet,
		&plan,
	); err != nil {
		return plan, err
	}
	if err := collectAffectedEvidenceRelationships(
		ctx,
		tx,
		runSet,
		&plan,
	); err != nil {
		return plan, err
	}
	if err := collectAffectedEvidenceCoverage(
		ctx,
		tx,
		runSet,
		&plan,
	); err != nil {
		return plan, err
	}
	if err := collectAffectedEvidenceStaging(
		ctx,
		tx,
		runSet,
		operationSet,
		&plan,
	); err != nil {
		return plan, err
	}
	return plan, nil
}

func collectDeletedExecutionIdentities(
	ctx context.Context,
	tx *sql.Tx,
	runIDs []string,
	destination map[evidencePrivateIdentity]struct{},
) error {
	if len(runIDs) == 0 {
		return nil
	}
	for _, query := range []struct {
		kind   string
		table  string
		column string
	}{
		{kind: "span", table: "spans", column: "span_id"},
		{kind: "artifact", table: "artifacts", column: "artifact_id"},
	} {
		rows, err := tx.QueryContext(ctx,
			"SELECT "+query.column+" FROM "+query.table+
				" WHERE run_id IN ("+queryPlaceholders(len(runIDs))+")",
			queryArgs(runIDs)...,
		)
		if err != nil {
			return fmt.Errorf("load deleted evidence %s identities: %w", query.kind, err)
		}
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				_ = rows.Close()
				return err
			}
			destination[evidencePrivateIdentity{
				kind: query.kind,
				id:   id,
			}] = struct{}{}
		}
		if err := rows.Err(); err != nil {
			_ = rows.Close()
			return err
		}
		if err := rows.Close(); err != nil {
			return err
		}
	}
	return nil
}

func collectAffectedEvidenceRelationships(
	ctx context.Context,
	tx *sql.Tx,
	deletedRuns map[string]struct{},
	plan *evidencePrivacyDeletionPlan,
) error {
	rows, err := tx.QueryContext(ctx, `
		SELECT evidence_id, subject_kind, subject_id, role, source_mode,
			source_kind, source_id, producer_kind, producer_id, run_id,
			edge_id, edge_record_id
		FROM evidence_relationships
		WHERE authorization_namespace = ?
	`, localEvidenceAuthorizationNamespace)
	if err != nil {
		return fmt.Errorf("load evidence relationships for privacy deletion: %w", err)
	}
	defer rows.Close()
	relationships := make([]evidencePrivacyRelationship, 0)
	for rows.Next() {
		var relationship evidencePrivacyRelationship
		if err := rows.Scan(
			&relationship.evidenceID,
			&relationship.subject.kind,
			&relationship.subject.id,
			&relationship.role,
			&relationship.sourceMode,
			&relationship.sourceKind,
			&relationship.sourceID,
			&relationship.producer.kind,
			&relationship.producer.id,
			&relationship.runID,
			&relationship.edgeID,
			&relationship.recordID,
		); err != nil {
			return err
		}
		relationships = append(relationships, relationship)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for _, relationship := range relationships {
		_, authoredByDeletedRun := deletedRuns[relationship.runID]
		if authoredByDeletedRun {
			plan.deletedIdentities[relationship.producer] = struct{}{}
		}
	}
	for _, relationship := range relationships {
		source := evidencePrivateIdentity{
			kind: relationship.sourceKind,
			id:   relationship.sourceID,
		}
		_, authoredByDeletedRun := deletedRuns[relationship.runID]
		if !authoredByDeletedRun &&
			!plan.identityDeleted(relationship.subject) &&
			!plan.identityDeleted(source) &&
			!plan.identityDeleted(relationship.producer) {
			continue
		}
		plan.relationships = append(plan.relationships, relationship)
		plan.evidenceIDs[relationship.evidenceID] = struct{}{}
	}
	return nil
}

func (plan evidencePrivacyDeletionPlan) identityDeleted(
	identity evidencePrivateIdentity,
) bool {
	_, deleted := plan.deletedIdentities[identity]
	return deleted
}

func stringSliceSet(values []string) map[string]struct{} {
	result := make(map[string]struct{}, len(values))
	for _, value := range values {
		result[value] = struct{}{}
	}
	return result
}
