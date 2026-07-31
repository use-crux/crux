package observability

import (
	"context"
	"fmt"
)

func loadEvidenceInspectMetadata(
	ctx context.Context,
	queryer evidenceQueryer,
	subjectKind string,
	subjectID string,
	relationshipCutoff string,
) (map[string][]string, map[string]bool, error) {
	coverage := make(map[string][]string)
	rows, err := queryer.QueryContext(ctx, `
		SELECT DISTINCT role, status FROM evidence_coverage_events
		WHERE authorization_namespace = ?
		  AND subject_kind = ? AND subject_id = ?
		  AND accepted_at > ?
	`, localEvidenceAuthorizationNamespace, subjectKind, subjectID,
		relationshipCutoff)
	if err != nil {
		return nil, nil, fmt.Errorf("load evidence coverage: %w", err)
	}
	for rows.Next() {
		var role, status string
		if err := rows.Scan(&role, &status); err != nil {
			_ = rows.Close()
			return nil, nil, err
		}
		coverage[role] = append(coverage[role], status)
	}
	if err := rows.Close(); err != nil {
		return nil, nil, err
	}
	truncated := make(map[string]bool)
	rows, err = queryer.QueryContext(ctx, `
		SELECT role FROM evidence_truncation_watermarks
		WHERE authorization_namespace = ?
		  AND subject_kind = ? AND subject_id = ?
		UNION
		SELECT role FROM evidence_relationships
		WHERE authorization_namespace = ?
		  AND subject_kind = ? AND subject_id = ?
		  AND relationship_accepted_at <= ?
		UNION
		SELECT role FROM evidence_coverage_events
		WHERE authorization_namespace = ?
		  AND subject_kind = ? AND subject_id = ?
		  AND accepted_at <= ?
	`, localEvidenceAuthorizationNamespace, subjectKind, subjectID,
		localEvidenceAuthorizationNamespace, subjectKind, subjectID,
		relationshipCutoff,
		localEvidenceAuthorizationNamespace, subjectKind, subjectID,
		relationshipCutoff)
	if err != nil {
		return nil, nil, fmt.Errorf("load evidence truncation: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var role string
		if err := rows.Scan(&role); err != nil {
			return nil, nil, err
		}
		truncated[role] = true
	}
	return coverage, truncated, rows.Err()
}

func resolveEvidenceInspectSubject(
	ctx context.Context,
	queryer evidenceQueryer,
	subject EvidenceInspectSubject,
) (string, error) {
	switch subject.Kind {
	case "artifact":
		if subject.ID == "" || subject.EffectID != "" {
			return "", ErrEvidenceNotFound
		}
		return resolveKnownEvidenceSubject(
			ctx,
			queryer,
			[]string{"artifact"},
			subject.ID,
		)
	case "execution":
		if subject.ID == "" || subject.EffectID != "" {
			return "", ErrEvidenceNotFound
		}
		return resolveKnownEvidenceSubject(
			ctx,
			queryer,
			[]string{"run", "span"},
			subject.ID,
		)
	default:
		return "", ErrEvidenceNotFound
	}
}

func resolveKnownEvidenceSubject(
	ctx context.Context,
	queryer evidenceQueryer,
	kinds []string,
	id string,
) (string, error) {
	for _, kind := range kinds {
		var exists int
		if err := queryer.QueryRowContext(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM evidence_relationships
				WHERE authorization_namespace = ?
				  AND subject_kind = ? AND subject_id = ?
				UNION ALL
				SELECT 1 FROM evidence_coverage_projection
				WHERE authorization_namespace = ?
				  AND subject_kind = ? AND subject_id = ?
				UNION ALL
				SELECT 1 FROM evidence_truncation_watermarks
				WHERE authorization_namespace = ?
				  AND subject_kind = ? AND subject_id = ?
			)
		`, localEvidenceAuthorizationNamespace, kind, id,
			localEvidenceAuthorizationNamespace, kind, id,
			localEvidenceAuthorizationNamespace, kind, id,
		).Scan(&exists); err != nil {
			return "", fmt.Errorf("resolve evidence subject: %w", err)
		}
		if exists != 0 {
			return kind, nil
		}
	}
	for _, kind := range kinds {
		table, column := "artifacts", "artifact_id"
		switch kind {
		case "run":
			table, column = "runs", "run_id"
		case "span":
			table, column = "spans", "span_id"
		}
		var exists int
		query := fmt.Sprintf(
			"SELECT EXISTS (SELECT 1 FROM %s WHERE %s = ?)",
			table,
			column,
		)
		if err := queryer.QueryRowContext(ctx, query, id).Scan(&exists); err != nil {
			return "", fmt.Errorf("resolve graph subject: %w", err)
		}
		if exists != 0 {
			return kind, nil
		}
	}
	return "", ErrEvidenceNotFound
}
