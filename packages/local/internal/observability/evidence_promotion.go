package observability

import (
	"context"
	"encoding/json"
	"fmt"
)

const evidenceStagingUnpromotableCode = "EVIDENCE_STAGING_UNPROMOTABLE"

type stagedEvidenceCandidate struct {
	digestVersion  int
	digest         string
	artifactID     string
	recordID       string
	runID          string
	operationID    string
	traceID        string
	segmentID      string
	segmentSeq     int
	captureState   string
	payload        string
	candidateBytes int
	retainedBytes  int
}

type eligibleEvidenceCandidate struct {
	record   Record
	artifact ArtifactRecord
	material evidenceCandidateMaterial
}

func (s *Service) promoteStagedEvidenceCandidate(
	ctx context.Context,
	statements *ingestStatements,
	edge EdgeRecord,
	attributes evidenceEdgeAttributes,
) error {
	staged, err := loadStagedEvidenceCandidates(
		ctx,
		statements,
		attributes.EvidenceID,
	)
	if err != nil {
		return err
	}
	unpromotable := int64(0)
	eligible := make([]eligibleEvidenceCandidate, 0, len(staged))
	for _, stored := range staged {
		record, artifact, marker, material, err :=
			decodeStagedEvidenceCandidate(stored)
		if err != nil {
			unpromotable++
			continue
		}
		matches, err := candidateMatchesEdge(
			edge,
			attributes,
			artifact,
			marker,
			material.Candidate,
		)
		if err != nil {
			return err
		}
		if !matches {
			continue
		}
		if admissionErr := validateEvidenceCandidatePromotionAdmission(
			ctx,
			statements,
			record,
			artifact,
		); admissionErr != nil {
			if _, retryable := classifyIngestDisposition(
				admissionErr,
			); retryable {
				return admissionErr
			}
			unpromotable++
			continue
		}
		eligible = append(eligible, eligibleEvidenceCandidate{
			record:   record,
			artifact: artifact,
			material: material,
		})
	}

	if attributes.ContentDigest == nil && len(eligible) > 1 {
		unpromotable += int64(len(eligible))
		eligible = nil
	}
	if len(eligible) == 1 {
		candidate := eligible[0]
		if err := beginEvidenceCandidateMaterialization(
			ctx,
			statements,
		); err != nil {
			return err
		}
		materializationErr := s.materializeEvidenceArtifact(
			ctx,
			statements,
			candidate.record,
			candidate.artifact,
		)
		if materializationErr != nil {
			if err := rollbackEvidenceCandidateMaterialization(
				ctx,
				statements,
			); err != nil {
				return err
			}
			if _, retryable := classifyIngestDisposition(
				materializationErr,
			); retryable {
				return materializationErr
			}
			unpromotable++
		} else {
			if err := commitEvidenceCandidateMaterialization(
				ctx,
				statements,
			); err != nil {
				return err
			}
			if err := persistEvidencePayloadRecordDigest(
				ctx,
				statements,
				attributes.EvidenceID,
				candidate.record,
			); err != nil {
				return err
			}
			if _, err := s.hydrateEvidenceRelationship(
				ctx,
				statements,
				attributes.EvidenceID,
				candidate.material.Candidate,
			); err != nil {
				return err
			}
		}
	}
	if err := deleteEvidenceCandidateSiblings(
		ctx,
		statements,
		attributes.EvidenceID,
	); err != nil {
		return err
	}
	if unpromotable > 0 {
		return recordEvidenceIngestHealth(
			ctx,
			statements,
			evidenceStagingUnpromotableCode,
			unpromotable,
			s.evidenceNow(),
		)
	}
	return nil
}

func beginEvidenceCandidateMaterialization(
	ctx context.Context,
	statements *ingestStatements,
) error {
	if _, err := statements.tx.ExecContext(
		ctx,
		`SAVEPOINT evidence_candidate_materialization`,
	); err != nil {
		return fmt.Errorf("begin evidence candidate materialization: %w", err)
	}
	return nil
}

func rollbackEvidenceCandidateMaterialization(
	ctx context.Context,
	statements *ingestStatements,
) error {
	if _, err := statements.tx.ExecContext(
		ctx,
		`ROLLBACK TO evidence_candidate_materialization`,
	); err != nil {
		return fmt.Errorf("rollback evidence candidate materialization: %w", err)
	}
	if _, err := statements.tx.ExecContext(
		ctx,
		`RELEASE evidence_candidate_materialization`,
	); err != nil {
		return fmt.Errorf("release rolled back evidence candidate: %w", err)
	}
	return nil
}

func commitEvidenceCandidateMaterialization(
	ctx context.Context,
	statements *ingestStatements,
) error {
	if _, err := statements.tx.ExecContext(
		ctx,
		`RELEASE evidence_candidate_materialization`,
	); err != nil {
		return fmt.Errorf("commit evidence candidate materialization: %w", err)
	}
	return nil
}

func loadStagedEvidenceCandidates(
	ctx context.Context,
	statements *ingestStatements,
	evidenceID string,
) ([]stagedEvidenceCandidate, error) {
	rows, err := statements.tx.QueryContext(ctx, `
		SELECT digest_version, candidate_digest, artifact_id, record_id,
			run_id, operation_id, ifnull(trace_id, ''), segment_id, segment_seq,
			capture_state, record_payload_json, candidate_bytes, retained_bytes
		FROM evidence_staging_candidates
		WHERE authorization_namespace = ? AND evidence_id = ?
		ORDER BY accepted_at, candidate_digest
	`, localEvidenceAuthorizationNamespace, evidenceID)
	if err != nil {
		return nil, fmt.Errorf("load staged evidence candidates: %w", err)
	}
	defer rows.Close()
	result := make([]stagedEvidenceCandidate, 0)
	for rows.Next() {
		var candidate stagedEvidenceCandidate
		if err := rows.Scan(
			&candidate.digestVersion,
			&candidate.digest,
			&candidate.artifactID,
			&candidate.recordID,
			&candidate.runID,
			&candidate.operationID,
			&candidate.traceID,
			&candidate.segmentID,
			&candidate.segmentSeq,
			&candidate.captureState,
			&candidate.payload,
			&candidate.candidateBytes,
			&candidate.retainedBytes,
		); err != nil {
			return nil, err
		}
		result = append(result, candidate)
	}
	return result, rows.Err()
}

func decodeStagedEvidenceCandidate(
	stored stagedEvidenceCandidate,
) (
	Record,
	ArtifactRecord,
	evidenceSourceArtifactMarker,
	evidenceCandidateMaterial,
	error,
) {
	var record Record
	if err := json.Unmarshal([]byte(stored.payload), &record); err != nil {
		return Record{}, ArtifactRecord{}, evidenceSourceArtifactMarker{},
			evidenceCandidateMaterial{}, err
	}
	if err := ValidateRecord(record); err != nil {
		return Record{}, ArtifactRecord{}, evidenceSourceArtifactMarker{},
			evidenceCandidateMaterial{}, err
	}
	artifact, marker, marked, err := parseEvidenceSourceArtifact(record)
	if err != nil || !marked {
		return Record{}, ArtifactRecord{}, evidenceSourceArtifactMarker{},
			evidenceCandidateMaterial{}, fmt.Errorf("invalid staged evidence marker")
	}
	material, err := materializeEvidenceCandidate(artifact, marker)
	if err != nil {
		return Record{}, ArtifactRecord{}, evidenceSourceArtifactMarker{},
			evidenceCandidateMaterial{}, err
	}
	if stored.digestVersion != evidenceCandidateDigestVersion ||
		stored.digest != material.Digest ||
		stored.artifactID != artifact.ArtifactID ||
		stored.recordID != record.RecordID ||
		stored.runID != record.RunID ||
		stored.operationID != record.OperationID ||
		stored.traceID != record.TraceID ||
		stored.segmentID != record.SegmentID ||
		stored.segmentSeq != record.SegmentSeq ||
		stored.captureState != marker.CaptureState ||
		stored.candidateBytes != len(material.Canonical) ||
		stored.retainedBytes != len(record.Payload) {
		return Record{}, ArtifactRecord{}, evidenceSourceArtifactMarker{},
			evidenceCandidateMaterial{}, fmt.Errorf("staged envelope mismatch")
	}
	return record, artifact, marker, material, nil
}
