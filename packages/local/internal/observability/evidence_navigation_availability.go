package observability

import (
	"context"
	"database/sql"
	"fmt"
)

func validEvidenceNavigationRef(ref NodeRef) bool {
	if ref.ID == "" {
		return false
	}
	switch ref.Kind {
	case "run", "span", "artifact", "effect.receipt":
		return true
	default:
		return false
	}
}

func evidenceNavigationUnavailableReason(
	ctx context.Context,
	queryer evidenceQueryer,
	ref NodeRef,
) (string, error) {
	var deleted int
	if err := queryer.QueryRowContext(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM evidence_deletion_tombstones
			WHERE authorization_namespace = ?
			  AND identity_kind = ?
			  AND digest_version = ?
			  AND identity_digest = ?
		)
	`, localEvidenceAuthorizationNamespace, ref.Kind,
		evidencePrivacyIdentityDigestVersion,
		evidencePrivateIdentityDigest(ref.ID)).Scan(&deleted); err != nil {
		return "", fmt.Errorf("check evidence navigation deletion: %w", err)
	}
	if deleted != 0 {
		return "deleted", nil
	}
	var retained int
	err := queryer.QueryRowContext(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM evidence_relationships
			WHERE authorization_namespace = ?
			  AND (
				(subject_kind = ? AND subject_id = ?)
				OR (source_kind = ? AND source_id = ?)
				OR (producer_kind = ? AND producer_id = ?)
			  )
		)
	`, localEvidenceAuthorizationNamespace,
		ref.Kind, ref.ID, ref.Kind, ref.ID, ref.Kind, ref.ID).Scan(&retained)
	if err != nil {
		return "", fmt.Errorf("check retained evidence navigation: %w", err)
	}
	if ref.Kind == "artifact" && retained == 0 {
		err = queryer.QueryRowContext(ctx, `
			SELECT EXISTS(
				SELECT 1 FROM approval_artifact_occurrences
				WHERE authorization_namespace = ? AND artifact_id = ?
				  AND state = 'retained-out'
			)
		`, localEvidenceAuthorizationNamespace, ref.ID).Scan(&retained)
		if err != nil && err != sql.ErrNoRows {
			return "", fmt.Errorf(
				"check retained approval navigation: %w",
				err,
			)
		}
	}
	if retained != 0 {
		return "retained-out", nil
	}
	return "unresolved", nil
}
