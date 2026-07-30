package observability

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

func loadEvidenceCursorValidUntil(
	ctx context.Context,
	queryer evidenceQueryer,
	subjectKind string,
	subjectID string,
	now time.Time,
	settings evidenceSettings,
) (string, error) {
	var earliest time.Time
	var acceptedAt sql.NullString
	relationshipCutoff := formatEvidenceAcceptanceTime(
		now.Add(-settings.RelationshipRetention),
	)
	if err := queryer.QueryRowContext(ctx, `
		SELECT min(relationship_accepted_at)
		FROM evidence_relationships
		WHERE authorization_namespace = ?
		  AND subject_kind = ? AND subject_id = ?
		  AND relationship_accepted_at > ?
	`, localEvidenceAuthorizationNamespace, subjectKind, subjectID,
		relationshipCutoff).Scan(&acceptedAt); err != nil {
		return "", fmt.Errorf("load evidence cursor relationship expiry: %w", err)
	}
	if acceptedAt.Valid {
		accepted, err := time.Parse(time.RFC3339Nano, acceptedAt.String)
		if err != nil {
			return "", fmt.Errorf("parse evidence relationship expiry: %w", err)
		}
		earliest = accepted.Add(settings.RelationshipRetention)
	}

	var payloadAcceptedAt sql.NullString
	payloadCutoff := formatEvidenceAcceptanceTime(
		now.Add(-settings.PayloadRetention),
	)
	if err := queryer.QueryRowContext(ctx, `
		SELECT min(payload_accepted_at)
		FROM evidence_relationships
		WHERE authorization_namespace = ?
		  AND subject_kind = ? AND subject_id = ?
		  AND relationship_accepted_at > ?
		  AND payload_state = 'available'
		  AND payload_accepted_at > ?
	`, localEvidenceAuthorizationNamespace, subjectKind, subjectID,
		relationshipCutoff, payloadCutoff).Scan(&payloadAcceptedAt); err != nil {
		return "", fmt.Errorf("load evidence cursor payload expiry: %w", err)
	}
	if payloadAcceptedAt.Valid {
		accepted, err := time.Parse(time.RFC3339Nano, payloadAcceptedAt.String)
		if err != nil {
			return "", fmt.Errorf("parse evidence payload expiry: %w", err)
		}
		earliest = earlierFutureEvidenceExpiry(
			earliest,
			accepted.Add(settings.PayloadRetention),
			now,
		)
	}

	var coverageExpiry sql.NullString
	if err := queryer.QueryRowContext(ctx, `
		SELECT min(expires_at)
		FROM evidence_coverage_events
		WHERE authorization_namespace = ?
		  AND subject_kind = ? AND subject_id = ?
		  AND expires_at > ?
	`, localEvidenceAuthorizationNamespace, subjectKind, subjectID,
		formatEvidenceAcceptanceTime(now)).Scan(&coverageExpiry); err != nil {
		return "", fmt.Errorf("load evidence cursor coverage expiry: %w", err)
	}
	if coverageExpiry.Valid {
		expiry, err := time.Parse(time.RFC3339Nano, coverageExpiry.String)
		if err != nil {
			return "", fmt.Errorf("parse evidence coverage expiry: %w", err)
		}
		earliest = earlierFutureEvidenceExpiry(earliest, expiry, now)
	}
	if earliest.IsZero() {
		return "", nil
	}
	return formatEvidenceAcceptanceTime(earliest), nil
}

func earlierFutureEvidenceExpiry(
	current time.Time,
	candidate time.Time,
	now time.Time,
) time.Time {
	if !candidate.After(now) {
		return current
	}
	if current.IsZero() || candidate.Before(current) {
		return candidate
	}
	return current
}
