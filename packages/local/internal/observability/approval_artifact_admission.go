package observability

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
)

const approvalArtifactSemanticDigestVersion = 1

func parseApprovalArtifact(
	record Record,
) (ArtifactRecord, bool, error) {
	if record.Type != RecordArtifact {
		return ArtifactRecord{}, false, nil
	}
	var artifact ArtifactRecord
	if err := json.Unmarshal(record.Payload, &artifact); err != nil {
		return ArtifactRecord{}, false, err
	}
	marked, err := validateApprovalArtifact(artifact)
	return artifact, marked, err
}

func (s *Service) ingestApprovalArtifact(
	ctx context.Context,
	statements *ingestStatements,
	record Record,
	artifact ArtifactRecord,
) error {
	if err := validateEvidenceOperationAdmission(
		ctx,
		statements,
		record,
	); err != nil {
		return err
	}
	if err := validateApprovalArtifactPrivacyAdmission(
		ctx,
		statements,
		artifact,
	); err != nil {
		return err
	}
	digest, err := approvalArtifactSemanticDigest(record.Payload)
	if err != nil {
		return err
	}
	existing, err := loadApprovalArtifactReservation(
		ctx,
		statements,
		artifact.ArtifactID,
	)
	if err != nil {
		return err
	}
	if existing != nil {
		if existing.state == "retained-out" {
			return nil
		}
		if existing.semanticDigest != digest {
			return evidenceConflict()
		}
		return nil
	}

	storedInserted, err := upsertStoredRecord(ctx, statements, record)
	if err != nil {
		return err
	}
	artifactInserted, err := insertImmutableEvidenceArtifact(
		ctx,
		statements,
		artifact,
	)
	if err != nil {
		return err
	}
	if _, err := statements.exec(ctx, `
		INSERT INTO approval_artifact_occurrences (
			authorization_namespace, artifact_id, identity_version,
			semantic_digest_version, state, semantic_digest,
			artifact_record_id, accepted_at
		) VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
	`, localEvidenceAuthorizationNamespace, artifact.ArtifactID,
		1, approvalArtifactSemanticDigestVersion, digest, record.RecordID,
		formatEvidenceAcceptanceTime(s.evidenceNow())); err != nil {
		return fmt.Errorf("reserve approval artifact occurrence: %w", err)
	}
	if err := insertApprovalArtifactPrivacySelectors(
		ctx,
		statements,
		record,
		artifact,
	); err != nil {
		return err
	}
	if !storedInserted {
		return nil
	}
	if err := upsertRunDeployment(
		ctx,
		statements,
		record.RunID,
		record.Deployment,
	); err != nil {
		return err
	}
	statements.markAffected(record.OperationID, record.RunID, record.SegmentID)
	if err := projectDefinitionActivity(ctx, statements, record); err != nil {
		return err
	}
	return updateRunRollups(
		ctx,
		statements,
		rollupDeltaForArtifact(artifact, storedInserted, artifactInserted),
	)
}

type storedApprovalArtifactReservation struct {
	state          string
	semanticDigest string
}

func loadApprovalArtifactReservation(
	ctx context.Context,
	statements *ingestStatements,
	artifactID string,
) (*storedApprovalArtifactReservation, error) {
	var version int
	var stored storedApprovalArtifactReservation
	var digest sql.NullString
	err := statements.queryRow(ctx, `
		SELECT semantic_digest_version, state, semantic_digest
		FROM approval_artifact_occurrences
		WHERE authorization_namespace = ? AND artifact_id = ?
	`, localEvidenceAuthorizationNamespace, artifactID).Scan(
		&version,
		&stored.state,
		&digest,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load approval artifact occurrence: %w", err)
	}
	if version != approvalArtifactSemanticDigestVersion {
		return nil, fmt.Errorf(
			"unsupported approval artifact semantic digest version %d",
			version,
		)
	}
	if stored.state == "active" {
		if !digest.Valid {
			return nil, fmt.Errorf("active approval artifact digest is missing")
		}
		stored.semanticDigest = digest.String
	} else if stored.state != "retained-out" || digest.Valid {
		return nil, fmt.Errorf("approval artifact reservation state is invalid")
	}
	return &stored, nil
}

func retainedOutApprovalArtifact(
	ctx context.Context,
	statements *ingestStatements,
	artifactID string,
) (bool, error) {
	var state string
	err := statements.queryRow(ctx, `
		SELECT state FROM approval_artifact_occurrences
		WHERE authorization_namespace = ? AND artifact_id = ?
	`, localEvidenceAuthorizationNamespace, artifactID).Scan(&state)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("load approval artifact state: %w", err)
	}
	return state == "retained-out", nil
}

func approvalArtifactSemanticDigest(payload json.RawMessage) (string, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(payload, &fields); err != nil {
		return "", fmt.Errorf("decode approval artifact payload: %w", err)
	}
	semantic := make(map[string]any, 7)
	for _, name := range []string{"kind", "contentType", "encoding"} {
		var value any
		if err := json.Unmarshal(fields[name], &value); err != nil {
			return "", fmt.Errorf("decode approval artifact %s: %w", name, err)
		}
		semantic[name] = value
	}
	for _, name := range []string{"preview", "hash", "sizeBytes", "uri"} {
		raw, present := fields[name]
		if !present {
			continue
		}
		var value any
		if err := json.Unmarshal(raw, &value); err != nil {
			return "", fmt.Errorf("decode approval artifact %s: %w", name, err)
		}
		semantic[name] = value
	}
	canonical, err := canonicalEvidenceJSON(semantic)
	if err != nil {
		return "", fmt.Errorf("canonicalize approval artifact content: %w", err)
	}
	sum := sha256.Sum256(canonical)
	return "sha256:" + hex.EncodeToString(sum[:]), nil
}
