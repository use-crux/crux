package observability

import (
	"context"
	"database/sql"
	"fmt"
)

type storedEvidenceReservation struct {
	subjectKind           string
	subjectID             string
	role                  string
	evidenceKind          string
	sourceMode            sql.NullString
	sourceKind            string
	sourceID              string
	contentDigestVersion  sql.NullInt64
	contentDigest         sql.NullString
	idempotencyKeyHash    sql.NullString
	canonicalRecordDigest string
}

func loadEvidenceReservation(
	ctx context.Context,
	statements *ingestStatements,
	evidenceID string,
) (*storedEvidenceReservation, error) {
	var stored storedEvidenceReservation
	err := statements.queryRow(ctx, `
		SELECT subject_kind, subject_id, role, evidence_kind, source_mode,
			source_kind, source_id, content_digest_version, content_digest,
			idempotency_key_hash, canonical_record_digest
		FROM evidence_reservations
		WHERE authorization_namespace = ? AND evidence_id = ?
	`, localEvidenceAuthorizationNamespace, evidenceID).Scan(
		&stored.subjectKind,
		&stored.subjectID,
		&stored.role,
		&stored.evidenceKind,
		&stored.sourceMode,
		&stored.sourceKind,
		&stored.sourceID,
		&stored.contentDigestVersion,
		&stored.contentDigest,
		&stored.idempotencyKeyHash,
		&stored.canonicalRecordDigest,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load evidence reservation: %w", err)
	}
	return &stored, nil
}

func sameEvidenceReservation(
	stored storedEvidenceReservation,
	edge EdgeRecord,
	attributes evidenceEdgeAttributes,
	sourceMode string,
	canonicalRecordDigest string,
) bool {
	sameIdentity := stored.subjectKind == edge.To.Kind &&
		stored.subjectID == edge.To.ID &&
		stored.role == attributes.Role &&
		stored.evidenceKind == attributes.EvidenceKind &&
		stored.sourceKind == edge.From.Kind &&
		stored.sourceID == edge.From.ID
	if attributes.ContentDigest != nil {
		return sameIdentity &&
			stored.sourceMode.String == sourceMode &&
			stored.contentDigestVersion.Valid &&
			stored.contentDigestVersion.Int64 ==
				int64(*attributes.ContentDigestVersion) &&
			stored.contentDigest.Valid &&
			stored.contentDigest.String == *attributes.ContentDigest &&
			stored.idempotencyKeyHash.Valid &&
			stored.idempotencyKeyHash.String == *attributes.IdempotencyKeyHash
	}
	return sameIdentity &&
		!stored.contentDigest.Valid &&
		stored.canonicalRecordDigest == canonicalRecordDigest
}

func evidenceDigestVerificationState(
	attributes evidenceEdgeAttributes,
	recomputed bool,
) string {
	if attributes.ContentDigest == nil {
		return "not-required"
	}
	if recomputed {
		return "verified"
	}
	return "pending"
}

func initialEvidencePayloadState(
	attributes evidenceEdgeAttributes,
) (string, string) {
	if attributes.CaptureState == nil {
		return "reference", ""
	}
	switch *attributes.CaptureState {
	case "redacted":
		return "redacted", "policy"
	case "not-captured":
		return "not-captured", ""
	default:
		return "reference", ""
	}
}

func resolvedEvidenceSourceMode(attributes evidenceEdgeAttributes) string {
	return *attributes.SourceMode
}

func evidenceConflict() error {
	return &evidenceDispositionError{
		code:      evidenceIdempotencyConflictCode,
		retryable: false,
	}
}

func nullIfInvalid(value sql.NullString) any {
	if !value.Valid {
		return nil
	}
	return value.String
}

func nullInt(value *int) any {
	if value == nil {
		return nil
	}
	return *value
}

func nullString(value *string) any {
	if value == nil || *value == "" {
		return nil
	}
	return *value
}
