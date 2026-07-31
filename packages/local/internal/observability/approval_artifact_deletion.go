package observability

import (
	"context"
	"database/sql"
	"fmt"
)

func collectAffectedApprovalArtifacts(
	ctx context.Context,
	tx *sql.Tx,
	deletedRuns map[string]struct{},
	deletedOperations map[string]struct{},
	plan *evidencePrivacyDeletionPlan,
) error {
	baseDigests := make(map[string]struct{})
	slotArtifactIDs := make(map[string]struct{})
	for _, selector := range []struct {
		kind       string
		identities map[string]struct{}
		base       bool
	}{
		{approvalSelectorBaseOperation, deletedOperations, true},
		{approvalSelectorBaseRun, deletedRuns, true},
		{approvalSelectorProducerOperation, deletedOperations, false},
		{approvalSelectorProducerRun, deletedRuns, false},
		{
			approvalSelectorProducerSpan,
			privateIdentityIDs(plan.deletedIdentities, "span"),
			false,
		},
	} {
		if err := collectApprovalArtifactsForSelectors(
			ctx,
			tx,
			selector.kind,
			selector.identities,
			selector.base,
			baseDigests,
			slotArtifactIDs,
		); err != nil {
			return err
		}
	}
	for artifactID := range privateIdentityIDs(
		plan.deletedIdentities,
		"artifact",
	) {
		slotArtifactIDs[artifactID] = struct{}{}
	}
	baseArtifactIDs, err := approvalArtifactsForBaseDigests(
		ctx,
		tx,
		baseDigests,
	)
	if err != nil {
		return err
	}
	for artifactID := range baseArtifactIDs {
		delete(slotArtifactIDs, artifactID)
	}
	return appendApprovalArtifactDeletions(
		ctx,
		tx,
		baseDigests,
		baseArtifactIDs,
		slotArtifactIDs,
		plan,
	)
}

func collectApprovalArtifactsForSelectors(
	ctx context.Context,
	tx *sql.Tx,
	kind string,
	identities map[string]struct{},
	base bool,
	baseDigests map[string]struct{},
	slotArtifactIDs map[string]struct{},
) error {
	for identity := range identities {
		digest := approvalArtifactSelectorDigest(kind, identity)
		rows, err := tx.QueryContext(ctx, `
			SELECT matched.artifact_id, base.selector_digest
			FROM approval_artifact_privacy_selectors matched
			JOIN approval_artifact_privacy_selectors base
			  ON base.authorization_namespace =
			     matched.authorization_namespace
			 AND base.artifact_id = matched.artifact_id
			 AND base.selector_kind = ?
			WHERE matched.authorization_namespace = ?
			  AND matched.selector_kind = ?
			  AND matched.digest_version = ?
			  AND matched.selector_digest = ?
		`, approvalSelectorBaseOccurrence,
			localEvidenceAuthorizationNamespace, kind,
			approvalArtifactPrivacySelectorDigestVersion, digest)
		if err != nil {
			return fmt.Errorf("select private approval occurrences: %w", err)
		}
		for rows.Next() {
			var artifactID, baseDigest string
			if err := rows.Scan(&artifactID, &baseDigest); err != nil {
				_ = rows.Close()
				return err
			}
			if base {
				baseDigests[baseDigest] = struct{}{}
			} else {
				slotArtifactIDs[artifactID] = struct{}{}
			}
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

func approvalArtifactsForBaseDigests(
	ctx context.Context,
	tx *sql.Tx,
	baseDigests map[string]struct{},
) (map[string]struct{}, error) {
	artifactIDs := make(map[string]struct{})
	for digest := range baseDigests {
		rows, err := tx.QueryContext(ctx, `
			SELECT artifact_id
			FROM approval_artifact_privacy_selectors
			WHERE authorization_namespace = ?
			  AND selector_kind = ?
			  AND digest_version = ?
			  AND selector_digest = ?
		`, localEvidenceAuthorizationNamespace,
			approvalSelectorBaseOccurrence,
			approvalArtifactPrivacySelectorDigestVersion, digest)
		if err != nil {
			return nil, fmt.Errorf("select approval occurrence slots: %w", err)
		}
		for rows.Next() {
			var artifactID string
			if err := rows.Scan(&artifactID); err != nil {
				_ = rows.Close()
				return nil, err
			}
			artifactIDs[artifactID] = struct{}{}
		}
		if err := rows.Err(); err != nil {
			_ = rows.Close()
			return nil, err
		}
		if err := rows.Close(); err != nil {
			return nil, err
		}
	}
	return artifactIDs, nil
}

func appendApprovalArtifactDeletions(
	ctx context.Context,
	tx *sql.Tx,
	baseDigests map[string]struct{},
	baseArtifactIDs map[string]struct{},
	slotArtifactIDs map[string]struct{},
	plan *evidencePrivacyDeletionPlan,
) error {
	for digest := range baseDigests {
		plan.approvalTombstones[evidencePrivateIdentity{
			kind: approvalOccurrenceBaseIdentityKind,
			id:   digest,
		}] = struct{}{}
	}
	for artifactID := range slotArtifactIDs {
		plan.approvalTombstones[approvalOccurrenceSlotIdentity(artifactID)] = struct{}{}
	}
	allArtifactIDs := make(map[string]struct{}, len(baseArtifactIDs)+len(slotArtifactIDs))
	for artifactID := range baseArtifactIDs {
		allArtifactIDs[artifactID] = struct{}{}
	}
	for artifactID := range slotArtifactIDs {
		allArtifactIDs[artifactID] = struct{}{}
	}
	for artifactID := range allArtifactIDs {
		artifact, err := loadApprovalPrivacyArtifact(ctx, tx, artifactID)
		if err != nil {
			return err
		}
		if artifact == nil {
			continue
		}
		plan.approvalArtifacts = append(plan.approvalArtifacts, *artifact)
		plan.deletedIdentities[evidencePrivateIdentity{
			kind: "artifact",
			id:   artifactID,
		}] = struct{}{}
	}
	return nil
}

func loadApprovalPrivacyArtifact(
	ctx context.Context,
	tx *sql.Tx,
	artifactID string,
) (*approvalPrivacyArtifact, error) {
	var artifact approvalPrivacyArtifact
	var recordID, runID sql.NullString
	err := tx.QueryRowContext(ctx, `
		SELECT occurrence.artifact_id, occurrence.artifact_record_id,
			artifact.run_id
		FROM approval_artifact_occurrences occurrence
		LEFT JOIN artifacts artifact
		  ON artifact.artifact_id = occurrence.artifact_id
		WHERE occurrence.authorization_namespace = ?
		  AND occurrence.artifact_id = ?
	`, localEvidenceAuthorizationNamespace, artifactID).Scan(
		&artifact.artifactID,
		&recordID,
		&runID,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load private approval artifact: %w", err)
	}
	artifact.recordID = recordID.String
	artifact.runID = runID.String
	return &artifact, nil
}

func deletePrivateApprovalArtifact(
	ctx context.Context,
	statements *ingestStatements,
	artifact approvalPrivacyArtifact,
) error {
	if _, err := statements.exec(ctx, `
		DELETE FROM approval_artifact_privacy_selectors
		WHERE authorization_namespace = ? AND artifact_id = ?
	`, localEvidenceAuthorizationNamespace, artifact.artifactID); err != nil {
		return fmt.Errorf("delete private approval selectors: %w", err)
	}
	if _, err := statements.exec(ctx, `
		DELETE FROM approval_artifact_occurrences
		WHERE authorization_namespace = ? AND artifact_id = ?
	`, localEvidenceAuthorizationNamespace, artifact.artifactID); err != nil {
		return fmt.Errorf("delete private approval reservation: %w", err)
	}
	if _, err := statements.exec(
		ctx,
		`DELETE FROM artifacts WHERE artifact_id = ?`,
		artifact.artifactID,
	); err != nil {
		return fmt.Errorf("delete private approval artifact: %w", err)
	}
	if artifact.recordID != "" {
		if _, err := statements.exec(
			ctx,
			`DELETE FROM records WHERE record_id = ?`,
			artifact.recordID,
		); err != nil {
			return fmt.Errorf("delete private approval record: %w", err)
		}
	}
	return nil
}

func privateIdentityIDs(
	identities map[evidencePrivateIdentity]struct{},
	kind string,
) map[string]struct{} {
	ids := make(map[string]struct{})
	for identity := range identities {
		if identity.kind == kind {
			ids[identity.id] = struct{}{}
		}
	}
	return ids
}
