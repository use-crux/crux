package observability

import (
	"context"
	"encoding/json"
	"fmt"
)

type approvalArtifactMigrationRow struct {
	artifactID string
	recordID   string
}

func migrateLegacyApprovalArtifactPrivacyState(
	ctx context.Context,
	runner sqliteRunner,
	deletedAt string,
) (int64, error) {
	if err := backfillActiveApprovalArtifactSelectors(ctx, runner); err != nil {
		return 0, err
	}
	return guardLegacyRetainedOutApprovalArtifacts(ctx, runner, deletedAt)
}

func backfillActiveApprovalArtifactSelectors(
	ctx context.Context,
	runner sqliteRunner,
) error {
	rows, err := runner.QueryContext(ctx, `
		SELECT artifact_id, artifact_record_id
		FROM approval_artifact_occurrences
		WHERE state = 'active'
		ORDER BY artifact_id
	`)
	if err != nil {
		return fmt.Errorf("list active approval artifact occurrences: %w", err)
	}
	active := make([]approvalArtifactMigrationRow, 0)
	for rows.Next() {
		var row approvalArtifactMigrationRow
		if err := rows.Scan(&row.artifactID, &row.recordID); err != nil {
			_ = rows.Close()
			return err
		}
		active = append(active, row)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, row := range active {
		if err := backfillActiveApprovalArtifactSelector(
			ctx,
			runner,
			row,
		); err != nil {
			return err
		}
	}
	return nil
}

func backfillActiveApprovalArtifactSelector(
	ctx context.Context,
	runner sqliteRunner,
	row approvalArtifactMigrationRow,
) error {
	var payload string
	if err := runner.QueryRowContext(ctx, `
		SELECT payload_json FROM records WHERE record_id = ?
	`, row.recordID).Scan(&payload); err != nil {
		return fmt.Errorf(
			"load active approval artifact record %q: %w",
			row.recordID,
			err,
		)
	}
	var record Record
	if err := json.Unmarshal([]byte(payload), &record); err != nil {
		return fmt.Errorf("decode active approval artifact record: %w", err)
	}
	artifact, marked, err := parseApprovalArtifact(record)
	if err != nil {
		return fmt.Errorf("validate active approval artifact record: %w", err)
	}
	if !marked || artifact.ArtifactID != row.artifactID {
		return fmt.Errorf("active approval artifact reservation is inconsistent")
	}
	expected, err := approvalArtifactPrivacySelectors(record, artifact)
	if err != nil {
		return err
	}
	matches, err := approvalArtifactSelectorSetMatches(
		ctx,
		runner,
		row.artifactID,
		expected,
	)
	if err != nil || matches {
		return err
	}
	if _, err := runner.ExecContext(ctx, `
		DELETE FROM approval_artifact_privacy_selectors
		WHERE authorization_namespace = ? AND artifact_id = ?
	`, localEvidenceAuthorizationNamespace, row.artifactID); err != nil {
		return fmt.Errorf("reset active approval artifact selectors: %w", err)
	}
	return storeApprovalArtifactPrivacySelectors(
		ctx,
		runner,
		row.artifactID,
		expected,
	)
}

func approvalArtifactSelectorSetMatches(
	ctx context.Context,
	runner sqliteRunner,
	artifactID string,
	expected []approvalArtifactPrivacySelector,
) (bool, error) {
	rows, err := runner.QueryContext(ctx, `
		SELECT selector_kind, digest_version, selector_digest
		FROM approval_artifact_privacy_selectors
		WHERE authorization_namespace = ? AND artifact_id = ?
	`, localEvidenceAuthorizationNamespace, artifactID)
	if err != nil {
		return false, fmt.Errorf("load approval artifact selectors: %w", err)
	}
	defer rows.Close()
	actual := make(map[string]string, len(expected))
	for rows.Next() {
		var kind, digest string
		var version int
		if err := rows.Scan(&kind, &version, &digest); err != nil {
			return false, err
		}
		if version != approvalArtifactPrivacySelectorDigestVersion {
			return false, nil
		}
		actual[kind] = digest
	}
	if err := rows.Err(); err != nil {
		return false, err
	}
	if len(actual) != len(expected) {
		return false, nil
	}
	for _, selector := range expected {
		if actual[selector.kind] != selector.digest {
			return false, nil
		}
	}
	return true, nil
}

func guardLegacyRetainedOutApprovalArtifacts(
	ctx context.Context,
	runner sqliteRunner,
	deletedAt string,
) (int64, error) {
	rows, err := runner.QueryContext(ctx, `
		SELECT artifact_id FROM approval_artifact_occurrences
		WHERE state = 'retained-out'
		ORDER BY artifact_id
	`)
	if err != nil {
		return 0, fmt.Errorf("list retained-out approval artifacts: %w", err)
	}
	artifactIDs := make([]string, 0)
	for rows.Next() {
		var artifactID string
		if err := rows.Scan(&artifactID); err != nil {
			_ = rows.Close()
			return 0, err
		}
		artifactIDs = append(artifactIDs, artifactID)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return 0, err
	}
	if err := rows.Close(); err != nil {
		return 0, err
	}
	var converted int64
	for _, artifactID := range artifactIDs {
		complete, err := retainedOutApprovalSelectorSetComplete(
			ctx,
			runner,
			artifactID,
		)
		if err != nil {
			return 0, err
		}
		if complete {
			continue
		}
		if err := guardLegacyRetainedOutApprovalArtifact(
			ctx,
			runner,
			artifactID,
			deletedAt,
		); err != nil {
			return 0, err
		}
		converted++
	}
	return converted, nil
}

func retainedOutApprovalSelectorSetComplete(
	ctx context.Context,
	runner sqliteRunner,
	artifactID string,
) (bool, error) {
	required := map[string]bool{
		approvalSelectorBaseOccurrence:    false,
		approvalSelectorBaseOperation:     false,
		approvalSelectorBaseRun:           false,
		approvalSelectorProducerOperation: false,
		approvalSelectorProducerRun:       false,
	}
	rows, err := runner.QueryContext(ctx, `
		SELECT selector_kind, digest_version, selector_digest
		FROM approval_artifact_privacy_selectors
		WHERE authorization_namespace = ? AND artifact_id = ?
	`, localEvidenceAuthorizationNamespace, artifactID)
	if err != nil {
		return false, fmt.Errorf("load retained-out approval selectors: %w", err)
	}
	defer rows.Close()
	count := 0
	for rows.Next() {
		var kind, digest string
		var version int
		if err := rows.Scan(&kind, &version, &digest); err != nil {
			return false, err
		}
		if version != approvalArtifactPrivacySelectorDigestVersion ||
			!contentDigestPattern.MatchString(digest) {
			return false, nil
		}
		if _, ok := required[kind]; ok {
			required[kind] = true
		} else if kind != approvalSelectorProducerSpan {
			return false, nil
		}
		count++
	}
	if err := rows.Err(); err != nil {
		return false, err
	}
	if count != len(required) && count != len(required)+1 {
		return false, nil
	}
	for _, present := range required {
		if !present {
			return false, nil
		}
	}
	return true, nil
}

func guardLegacyRetainedOutApprovalArtifact(
	ctx context.Context,
	runner sqliteRunner,
	artifactID string,
	deletedAt string,
) error {
	identity := approvalOccurrenceSlotIdentity(artifactID)
	if _, err := runner.ExecContext(ctx, `
		INSERT INTO evidence_deletion_tombstones (
			authorization_namespace, identity_kind, digest_version,
			identity_digest, deleted_at
		) VALUES (?, ?, ?, ?, ?)
		ON CONFLICT DO NOTHING
	`, localEvidenceAuthorizationNamespace, identity.kind,
		evidencePrivacyIdentityDigestVersion,
		evidencePrivateIdentityDigest(identity.id), deletedAt); err != nil {
		return fmt.Errorf("guard legacy retained-out approval artifact: %w", err)
	}
	if _, err := runner.ExecContext(ctx, `
		DELETE FROM approval_artifact_privacy_selectors
		WHERE authorization_namespace = ? AND artifact_id = ?
	`, localEvidenceAuthorizationNamespace, artifactID); err != nil {
		return fmt.Errorf("delete legacy approval artifact selectors: %w", err)
	}
	if _, err := runner.ExecContext(ctx, `
		DELETE FROM approval_artifact_occurrences
		WHERE authorization_namespace = ? AND artifact_id = ?
	`, localEvidenceAuthorizationNamespace, artifactID); err != nil {
		return fmt.Errorf("delete legacy retained-out approval artifact: %w", err)
	}
	return nil
}
