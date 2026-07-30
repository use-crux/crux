package observability

import (
	"context"
	"database/sql"
	"fmt"
)

func bumpEvidenceSubjectRevision(
	ctx context.Context,
	statements *ingestStatements,
	subjectKind string,
	subjectID string,
) error {
	if _, err := statements.exec(ctx, `
		INSERT INTO evidence_subject_revisions (
			authorization_namespace, subject_kind, subject_id, revision
		) VALUES (?, ?, ?, 1)
		ON CONFLICT (
			authorization_namespace, subject_kind, subject_id
		) DO UPDATE SET revision = revision + 1
	`, localEvidenceAuthorizationNamespace, subjectKind, subjectID); err != nil {
		return fmt.Errorf("bump evidence subject revision: %w", err)
	}
	return nil
}

func evidenceSubjectRevision(
	ctx context.Context,
	queryer evidenceQueryer,
	subjectKind string,
	subjectID string,
) (int64, error) {
	var revision int64
	err := queryer.QueryRowContext(ctx, `
		SELECT revision FROM evidence_subject_revisions
		WHERE authorization_namespace = ?
		  AND subject_kind = ? AND subject_id = ?
	`, localEvidenceAuthorizationNamespace, subjectKind, subjectID).Scan(
		&revision,
	)
	if err == sql.ErrNoRows {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("load evidence subject revision: %w", err)
	}
	return revision, nil
}
