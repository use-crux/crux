package observability

import (
	"context"
	"database/sql"
	"fmt"
)

const evidencePayloadRecordDigestVersion = 1

func persistEvidencePayloadRecordDigest(
	ctx context.Context,
	statements *ingestStatements,
	evidenceID string,
	record Record,
) error {
	digest, err := evidenceCanonicalRecordDigest(record)
	if err != nil {
		return err
	}
	return persistEvidencePayloadDigest(
		ctx,
		statements,
		evidenceID,
		digest,
	)
}

func persistEvidencePayloadRecordDigestIfMissing(
	ctx context.Context,
	statements *ingestStatements,
	evidenceID string,
	record Record,
) error {
	digest, err := evidenceCanonicalRecordDigest(record)
	if err != nil {
		return err
	}
	if _, err := statements.exec(ctx, `
		INSERT INTO evidence_payload_records (
			authorization_namespace, evidence_id,
			record_digest_version, record_digest
		) VALUES (?, ?, ?, ?)
		ON CONFLICT(authorization_namespace, evidence_id) DO NOTHING
	`, localEvidenceAuthorizationNamespace, evidenceID,
		evidencePayloadRecordDigestVersion, digest); err != nil {
		return fmt.Errorf(
			"backfill evidence payload record digest: %w",
			err,
		)
	}
	return nil
}

func persistEvidencePayloadDigest(
	ctx context.Context,
	statements *ingestStatements,
	evidenceID string,
	digest string,
) error {
	if _, err := statements.exec(ctx, `
		INSERT INTO evidence_payload_records (
			authorization_namespace, evidence_id,
			record_digest_version, record_digest
		) VALUES (?, ?, ?, ?)
		ON CONFLICT(authorization_namespace, evidence_id) DO NOTHING
	`, localEvidenceAuthorizationNamespace, evidenceID,
		evidencePayloadRecordDigestVersion, digest); err != nil {
		return fmt.Errorf("persist evidence payload record digest: %w", err)
	}
	var version int
	var stored string
	if err := statements.queryRow(ctx, `
		SELECT record_digest_version, record_digest
		FROM evidence_payload_records
		WHERE authorization_namespace = ? AND evidence_id = ?
	`, localEvidenceAuthorizationNamespace, evidenceID).Scan(
		&version,
		&stored,
	); err != nil {
		return fmt.Errorf("load evidence payload record digest: %w", err)
	}
	if version != evidencePayloadRecordDigestVersion || stored != digest {
		return evidenceConflict()
	}
	return nil
}

func reconcileExpiredEvidencePayloadRetry(
	ctx context.Context,
	statements *ingestStatements,
	evidenceID string,
	record Record,
) (bool, error) {
	var expiredAt sql.NullString
	if err := statements.queryRow(ctx, `
		SELECT payload_expired_at
		FROM evidence_relationships
		WHERE authorization_namespace = ? AND evidence_id = ?
	`, localEvidenceAuthorizationNamespace, evidenceID).Scan(
		&expiredAt,
	); err != nil {
		return false, fmt.Errorf("load evidence payload expiry: %w", err)
	}
	if !expiredAt.Valid {
		return false, nil
	}
	var version int
	var stored string
	err := statements.queryRow(ctx, `
		SELECT record_digest_version, record_digest
		FROM evidence_payload_records
		WHERE authorization_namespace = ? AND evidence_id = ?
	`, localEvidenceAuthorizationNamespace, evidenceID).Scan(
		&version,
		&stored,
	)
	if err == sql.ErrNoRows {
		return true, evidenceConflict()
	}
	if err != nil {
		return true, fmt.Errorf("load compacted payload identity: %w", err)
	}
	submitted, err := evidenceCanonicalRecordDigest(record)
	if err != nil {
		return true, err
	}
	if version != evidencePayloadRecordDigestVersion || stored != submitted {
		return true, evidenceConflict()
	}
	return true, nil
}
