package observability

import (
	"context"
	"database/sql"
	"fmt"
)

type evidenceRoleSummary struct {
	conclusion      string
	conflicting     bool
	missingHistory  bool
	activeCount     int
	usableCount     int
	redactedCount   int
	uncapturedCount int
}

func loadEvidenceRoleSummaries(
	ctx context.Context,
	queryer evidenceQueryer,
	subjectKind string,
	subjectID string,
	relationshipCutoff string,
	payloadCutoff string,
) (map[string]evidenceRoleSummary, error) {
	rows, err := queryer.QueryContext(ctx, `
		WITH classified AS (
			SELECT relationship.role, relationship.conclusion,
				CASE
					WHEN relationship.payload_state = 'available'
					 AND relationship.payload_accepted_at <= ?
					THEN 'redacted'
					ELSE relationship.payload_state
				END AS payload_state,
				relationship.superseded AS is_history,
				EXISTS (
					SELECT 1
					FROM evidence_supersessions supersession
					LEFT JOIN evidence_relationships predecessor
					  ON predecessor.authorization_namespace =
					     supersession.authorization_namespace
					 AND predecessor.evidence_id =
					     supersession.superseded_evidence_id
					 AND predecessor.subject_kind =
					     relationship.subject_kind
					 AND predecessor.subject_id = relationship.subject_id
					 AND predecessor.role = relationship.role
					 AND predecessor.relationship_accepted_at > ?
					WHERE supersession.authorization_namespace =
					      relationship.authorization_namespace
					  AND supersession.evidence_id =
					      relationship.evidence_id
					  AND predecessor.evidence_id IS NULL
				) AS missing_history
			FROM evidence_relationships relationship
			WHERE relationship.authorization_namespace = ?
			  AND relationship.subject_kind = ?
			  AND relationship.subject_id = ?
			  AND relationship.relationship_accepted_at > ?
		)
		SELECT role,
			COUNT(CASE WHEN is_history = 0 THEN 1 END) AS active_count,
			COUNT(CASE
				WHEN is_history = 0
				 AND payload_state IN ('available', 'reference')
				THEN 1
			END) AS usable_count,
			COUNT(CASE
				WHEN is_history = 0 AND payload_state = 'redacted'
				THEN 1
			END) AS redacted_count,
			COUNT(CASE
				WHEN is_history = 0 AND payload_state = 'not-captured'
				THEN 1
			END) AS uncaptured_count,
			COUNT(DISTINCT CASE
				WHEN is_history = 0 THEN conclusion
			END) AS conclusion_count,
			MIN(CASE WHEN is_history = 0 THEN conclusion END),
			MAX(missing_history)
		FROM classified
		GROUP BY role
	`, payloadCutoff, relationshipCutoff,
		localEvidenceAuthorizationNamespace, subjectKind, subjectID,
		relationshipCutoff)
	if err != nil {
		return nil, fmt.Errorf("load evidence role summaries: %w", err)
	}
	defer rows.Close()
	result := make(map[string]evidenceRoleSummary, len(evidenceRoleOrder))
	for rows.Next() {
		var role string
		var activeCount, usableCount, redactedCount, uncapturedCount int
		var conclusionCount, missing int
		var conclusion sql.NullString
		if err := rows.Scan(
			&role,
			&activeCount,
			&usableCount,
			&redactedCount,
			&uncapturedCount,
			&conclusionCount,
			&conclusion,
			&missing,
		); err != nil {
			return nil, err
		}
		summary := evidenceRoleSummary{
			activeCount:     activeCount,
			usableCount:     usableCount,
			redactedCount:   redactedCount,
			uncapturedCount: uncapturedCount,
			conflicting:     conclusionCount > 1,
			missingHistory:  missing != 0,
		}
		if conclusionCount == 1 {
			summary.conclusion = conclusion.String
		}
		result[role] = summary
	}
	return result, rows.Err()
}
