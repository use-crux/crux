package observability

import (
	"context"
	"fmt"
)

// rebuildProvisionalApprovalArtifactSchema upgrades only the unpublished
// active-only reservation shape while preserving its first-write state.
func rebuildProvisionalApprovalArtifactSchema(
	ctx context.Context,
	runner sqliteRunner,
) error {
	columns, exists, err := tableColumns(
		ctx,
		runner,
		"approval_artifact_occurrences",
	)
	if err != nil || !exists || columns["state"] {
		return err
	}
	if !isProvisionalApprovalArtifactShape(columns) {
		return fmt.Errorf("unrecognized approval artifact occurrence schema")
	}
	for _, statement := range []string{
		`ALTER TABLE approval_artifact_occurrences
		 RENAME TO approval_artifact_occurrences_provisional`,
		approvalArtifactOccurrenceSchema,
		`INSERT INTO approval_artifact_occurrences (
			authorization_namespace, artifact_id, identity_version,
			semantic_digest_version, state, semantic_digest,
			artifact_record_id, accepted_at
		)
		SELECT authorization_namespace, artifact_id, 1,
			semantic_digest_version, 'active', semantic_digest,
			artifact_record_id, accepted_at
		FROM approval_artifact_occurrences_provisional`,
		`DROP TABLE approval_artifact_occurrences_provisional`,
	} {
		if _, err := runner.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf(
				"rebuild approval artifact occurrence schema: %w",
				err,
			)
		}
	}
	return nil
}

func isProvisionalApprovalArtifactShape(columns map[string]bool) bool {
	return columns["authorization_namespace"] &&
		columns["artifact_id"] &&
		columns["semantic_digest_version"] &&
		columns["semantic_digest"] &&
		columns["artifact_record_id"] &&
		columns["accepted_at"] &&
		!columns["identity_version"] &&
		!columns["state"]
}
