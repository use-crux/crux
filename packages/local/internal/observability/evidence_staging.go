package observability

import (
	"bytes"
	"context"
	"database/sql"
	"fmt"
	"time"
)

func (s *Service) stageEvidenceSourceArtifact(
	ctx context.Context,
	statements *ingestStatements,
	record Record,
	artifact ArtifactRecord,
	marker evidenceSourceArtifactMarker,
) error {
	material, err := materializeEvidenceCandidate(artifact, marker)
	if err != nil {
		return err
	}
	reservation, err := loadEvidenceReservation(
		ctx,
		statements,
		marker.EvidenceID,
	)
	if err != nil {
		return err
	}
	if reservation != nil {
		return s.reconcileDirectEvidenceArtifact(
			ctx,
			statements,
			record,
			artifact,
			marker,
			material,
			*reservation,
		)
	}
	now := s.evidenceNow().UTC()
	if err := expireEvidenceStagingCandidates(ctx, statements, now); err != nil {
		return err
	}
	duplicate, err := validateStagedRecordIdentity(
		ctx,
		statements,
		record,
	)
	if err != nil || duplicate {
		return err
	}
	var exists int
	if err := statements.queryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM evidence_staging_candidates
			WHERE authorization_namespace = ?
			  AND evidence_id = ?
			  AND digest_version = ?
			  AND candidate_digest = ?
		)
	`, localEvidenceAuthorizationNamespace, marker.EvidenceID,
		evidenceCandidateDigestVersion, material.Digest).Scan(&exists); err != nil {
		return fmt.Errorf("check duplicate evidence candidate: %w", err)
	}
	if exists != 0 {
		return nil
	}
	if err := ensureEvidenceStagingCapacity(
		ctx,
		statements,
		marker.EvidenceID,
		len(record.Payload),
	); err != nil {
		return err
	}
	acceptedAt := formatEvidenceAcceptanceTime(now)
	expiresAt := formatEvidenceAcceptanceTime(
		now.Add(s.evidenceSettings.StagingTTL),
	)
	if _, err := statements.exec(ctx, `
		INSERT INTO evidence_staging_candidates (
			authorization_namespace, evidence_id, digest_version,
			candidate_digest, artifact_id, record_id, run_id, operation_id,
			trace_id, segment_id, segment_seq, capture_state,
			record_payload_json, candidate_bytes, retained_bytes,
			accepted_at, expires_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, localEvidenceAuthorizationNamespace, marker.EvidenceID,
		evidenceCandidateDigestVersion, material.Digest, artifact.ArtifactID,
		record.RecordID, record.RunID, record.OperationID,
		nullIfEmpty(record.TraceID), record.SegmentID, record.SegmentSeq,
		marker.CaptureState, string(record.Payload), len(material.Canonical),
		len(record.Payload), acceptedAt, expiresAt); err != nil {
		return fmt.Errorf("stage evidence candidate: %w", err)
	}
	return nil
}

func validateStagedRecordIdentity(
	ctx context.Context,
	statements *ingestStatements,
	record Record,
) (bool, error) {
	var payload string
	err := statements.queryRow(ctx, `
		SELECT record_payload_json
		FROM evidence_staging_candidates
		WHERE authorization_namespace = ? AND record_id = ?
	`, localEvidenceAuthorizationNamespace, record.RecordID).Scan(&payload)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("load staged record identity: %w", err)
	}
	existing, err := canonicalJSON([]byte(payload))
	if err != nil {
		return false, fmt.Errorf("canonicalize staged record: %w", err)
	}
	submitted, err := canonicalJSON(record.Payload)
	if err != nil {
		return false, fmt.Errorf("canonicalize submitted record: %w", err)
	}
	if !bytes.Equal(existing, submitted) {
		return false, &recordIDConflictError{recordID: record.RecordID}
	}
	return true, nil
}

func ensureEvidenceStagingCapacity(
	ctx context.Context,
	statements *ingestStatements,
	evidenceID string,
	retainedBytes int,
) error {
	var perEvidence int
	if err := statements.queryRow(ctx, `
		SELECT count(*) FROM evidence_staging_candidates
		WHERE authorization_namespace = ? AND evidence_id = ?
	`, localEvidenceAuthorizationNamespace, evidenceID).Scan(&perEvidence); err != nil {
		return fmt.Errorf("count evidence candidates: %w", err)
	}
	var namespaceRows, namespaceBytes int
	if err := statements.queryRow(ctx, `
		SELECT count(*), coalesce(sum(retained_bytes), 0)
		FROM evidence_staging_candidates
		WHERE authorization_namespace = ?
	`, localEvidenceAuthorizationNamespace).Scan(
		&namespaceRows,
		&namespaceBytes,
	); err != nil {
		return fmt.Errorf("count namespace evidence candidates: %w", err)
	}
	var projectRows, projectBytes int
	if err := statements.queryRow(ctx, `
		SELECT count(*), coalesce(sum(retained_bytes), 0)
		FROM evidence_staging_candidates
	`).Scan(&projectRows, &projectBytes); err != nil {
		return fmt.Errorf("count project evidence candidates: %w", err)
	}
	if perEvidence >= evidenceCandidatesPerEvidence ||
		namespaceRows >= evidenceCandidatesPerNamespace ||
		namespaceBytes+retainedBytes > evidenceCandidateBytesPerNamespace ||
		projectRows >= evidenceCandidatesPerProject ||
		projectBytes+retainedBytes > evidenceCandidateBytesPerProject {
		return evidenceStagingCapacity()
	}
	return nil
}

func expireEvidenceStagingCandidates(
	ctx context.Context,
	statements *ingestStatements,
	now time.Time,
) error {
	result, err := statements.exec(ctx, `
		DELETE FROM evidence_staging_candidates
		WHERE expires_at <= ?
	`, formatEvidenceAcceptanceTime(now))
	if err != nil {
		return fmt.Errorf("expire evidence candidates: %w", err)
	}
	expired, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("count expired evidence candidates: %w", err)
	}
	if expired == 0 {
		return nil
	}
	return recordEvidenceIngestHealth(
		ctx,
		statements,
		"EVIDENCE_STAGING_EXPIRED",
		expired,
		now,
	)
}

func recordEvidenceIngestHealth(
	ctx context.Context,
	statements *ingestStatements,
	code string,
	occurrences int64,
	now time.Time,
) error {
	timestamp := formatEvidenceAcceptanceTime(now)
	if _, err := statements.exec(ctx, `
		INSERT INTO evidence_ingest_health (
			authorization_namespace, code, occurrence_count,
			first_seen_at, last_seen_at
		) VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(authorization_namespace, code) DO UPDATE SET
			occurrence_count = occurrence_count + excluded.occurrence_count,
			last_seen_at = excluded.last_seen_at
	`, localEvidenceAuthorizationNamespace, code, occurrences,
		timestamp, timestamp); err != nil {
		return fmt.Errorf("record evidence ingest health: %w", err)
	}
	return nil
}

func (s *Service) recordEvidenceIngestHealthOutsideTransaction(
	ctx context.Context,
	code string,
	occurrences int64,
) error {
	ctx, cancel := s.mutationContext(ctx)
	defer cancel()
	s.mutationMu.Lock()
	defer s.mutationMu.Unlock()

	timestamp := formatEvidenceAcceptanceTime(s.evidenceNow())
	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO evidence_ingest_health (
			authorization_namespace, code, occurrence_count,
			first_seen_at, last_seen_at
		) VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(authorization_namespace, code) DO UPDATE SET
			occurrence_count = occurrence_count + excluded.occurrence_count,
			last_seen_at = excluded.last_seen_at
	`, localEvidenceAuthorizationNamespace, code, occurrences,
		timestamp, timestamp); err != nil {
		return fmt.Errorf("record evidence ingest health: %w", err)
	}
	return nil
}
