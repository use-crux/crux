package observability

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

type evidenceRelationshipRow struct {
	id                       string
	subjectKind              string
	subjectID                string
	role                     string
	evidenceKind             string
	conclusion               sql.NullString
	observedAt               sql.NullString
	recordedAt               string
	sourceKind               string
	sourceID                 string
	producerKind             string
	producerID               string
	payloadState             string
	payload                  sql.NullString
	payloadUnavailableReason sql.NullString
	terminalKind             sql.NullString
	terminalID               sql.NullString
	acceptedAt               string
	isHistory                bool
	supersedes               []EvidenceInspectRef
}

func loadEvidenceRelationshipPage(
	ctx context.Context,
	queryer evidenceQueryer,
	subjectKind string,
	subjectID string,
	role string,
	includeHistory bool,
	cursor *evidenceCursorV1,
	limit int,
	relationshipCutoff string,
	payloadCutoff string,
) ([]evidenceRelationshipRow, error) {
	query := `
		SELECT relationship.evidence_id, relationship.subject_kind,
			relationship.subject_id, relationship.role,
			relationship.evidence_kind, relationship.conclusion,
			relationship.observed_at, relationship.recorded_at,
			relationship.source_kind, relationship.source_id,
			relationship.producer_kind, relationship.producer_id,
			CASE
				WHEN relationship.payload_state = 'available'
				 AND relationship.payload_accepted_at <= ?
				THEN 'redacted'
				ELSE relationship.payload_state
			END,
			CASE
				WHEN relationship.payload_state = 'available'
				 AND relationship.payload_accepted_at <= ?
				THEN NULL
				ELSE relationship.payload_json
			END,
			CASE
				WHEN relationship.payload_state = 'available'
				 AND relationship.payload_accepted_at <= ?
				THEN 'retention'
				ELSE relationship.payload_unavailable_reason
			END,
			relationship.accepted_after_terminal_kind,
			relationship.accepted_after_terminal_id,
			relationship.relationship_accepted_at,
			relationship.superseded AS is_history
		FROM evidence_relationships relationship
		WHERE relationship.authorization_namespace = ?
		  AND relationship.subject_kind = ?
		  AND relationship.subject_id = ?
		  AND relationship.role = ?
		  AND relationship.relationship_accepted_at > ?`
	args := []any{
		payloadCutoff,
		payloadCutoff,
		payloadCutoff,
		localEvidenceAuthorizationNamespace,
		subjectKind,
		subjectID,
		role,
		relationshipCutoff,
	}
	if !includeHistory {
		query += ` AND relationship.superseded = 0`
	}
	if cursor != nil {
		query += ` AND (
			relationship.relationship_accepted_at < ?
			OR (
				relationship.relationship_accepted_at = ?
				AND relationship.evidence_id < ?
			)
		)`
		args = append(args, cursor.AcceptedAt, cursor.AcceptedAt, cursor.EvidenceID)
	}
	query += `
		ORDER BY relationship.relationship_accepted_at DESC,
			relationship.evidence_id DESC
		LIMIT ?`
	args = append(args, limit+1)
	rows, err := queryer.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("load evidence relationship page: %w", err)
	}
	defer rows.Close()
	result := make([]evidenceRelationshipRow, 0, limit+1)
	for rows.Next() {
		var row evidenceRelationshipRow
		if err := rows.Scan(
			&row.id, &row.subjectKind, &row.subjectID, &row.role,
			&row.evidenceKind, &row.conclusion, &row.observedAt,
			&row.recordedAt, &row.sourceKind, &row.sourceID,
			&row.producerKind, &row.producerID, &row.payloadState,
			&row.payload, &row.payloadUnavailableReason, &row.terminalKind,
			&row.terminalID, &row.acceptedAt, &row.isHistory,
		); err != nil {
			return nil, err
		}
		result = append(result, row)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := loadEvidencePageSupersessions(
		ctx,
		queryer,
		result,
		relationshipCutoff,
	); err != nil {
		return nil, err
	}
	return result, nil
}

func loadEvidencePageSupersessions(
	ctx context.Context,
	queryer evidenceQueryer,
	page []evidenceRelationshipRow,
	relationshipCutoff string,
) error {
	if len(page) == 0 {
		return nil
	}
	byID := make(map[string]*evidenceRelationshipRow, len(page))
	args := make([]any, 0, len(page)+1)
	args = append(args, localEvidenceAuthorizationNamespace)
	for index := range page {
		byID[page[index].id] = &page[index]
		args = append(args, page[index].id)
	}
	query := `
		SELECT supersession.evidence_id, predecessor.evidence_id,
			predecessor.subject_kind, predecessor.subject_id,
			predecessor.role, predecessor.evidence_kind,
			predecessor.recorded_at
		FROM evidence_supersessions supersession
		JOIN evidence_relationships predecessor
		  ON predecessor.authorization_namespace =
		     supersession.authorization_namespace
		 AND predecessor.evidence_id =
		     supersession.superseded_evidence_id
		WHERE supersession.authorization_namespace = ?
		  AND supersession.evidence_id IN (` +
		strings.TrimSuffix(strings.Repeat("?,", len(page)), ",") + `)
		  AND predecessor.relationship_accepted_at > ?
		ORDER BY supersession.evidence_id,
			supersession.superseded_evidence_id`
	args = append(args, relationshipCutoff)
	rows, err := queryer.QueryContext(ctx, query, args...)
	if err != nil {
		return fmt.Errorf("load evidence page supersessions: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var ownerID string
		var ref EvidenceInspectRef
		if err := rows.Scan(
			&ownerID,
			&ref.ID,
			&ref.Subject.Kind,
			&ref.Subject.ID,
			&ref.Role,
			&ref.EvidenceKind,
			&ref.RecordedAt,
		); err != nil {
			return err
		}
		owner := byID[ownerID]
		if owner == nil ||
			ref.Subject.Kind != owner.subjectKind ||
			ref.Subject.ID != owner.subjectID ||
			ref.Role != owner.role {
			continue
		}
		subjectKind := ref.Subject.Kind
		ref.Kind = "execution.evidence"
		ref.Subject = publicEvidenceSubject(subjectKind, ref.Subject.ID)
		owner.supersedes = append(owner.supersedes, ref)
	}
	return rows.Err()
}
