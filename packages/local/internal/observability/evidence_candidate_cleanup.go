package observability

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
)

// cleanupEvidenceCandidatesForBatch commits deterministic candidate cleanup
// before an independently validated edge enters its ingest transaction.
func (s *Service) cleanupEvidenceCandidatesForBatch(
	ctx context.Context,
	batch Batch,
) (err error) {
	evidenceIDs := evidenceIDsFromValidEdges(batch)
	if len(evidenceIDs) == 0 {
		return nil
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin evidence candidate cleanup: %w", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()
	statements := newIngestStatements(tx)
	defer func() {
		if closeErr := statements.close(); closeErr != nil && err == nil {
			err = closeErr
		}
	}()
	for _, record := range batch.Records {
		if record.Type != RecordEdge || ValidateRecord(record) != nil {
			continue
		}
		if _, qualified, err := evidencePrivateIdentitiesForRecord(record); err != nil {
			return err
		} else if !qualified {
			continue
		}
		if err := validateEvidenceOperationAdmission(
			ctx,
			statements,
			record,
		); err != nil {
			var deleted *operationDeletedError
			if errors.As(err, &deleted) {
				continue
			}
			return err
		}
		if err := validateEvidencePrivacyAdmission(
			ctx,
			statements,
			record,
		); err != nil {
			return err
		}
	}

	if err := expireEvidenceStagingCandidates(
		ctx,
		statements,
		s.evidenceNow().UTC(),
	); err != nil {
		return err
	}
	var removed int64
	for _, evidenceID := range evidenceIDs {
		candidates, err := loadStagedEvidenceCandidates(
			ctx,
			statements,
			evidenceID,
		)
		if err != nil {
			return err
		}
		for _, stored := range candidates {
			record, artifact, _, _, decodeErr :=
				decodeStagedEvidenceCandidate(stored)
			admissionErr := decodeErr
			permanent := decodeErr != nil
			if admissionErr == nil {
				admissionErr = validateEvidenceCandidatePromotionAdmission(
					ctx,
					statements,
					record,
					artifact,
				)
			}
			if admissionErr == nil {
				continue
			}
			if _, retryable := classifyIngestDisposition(admissionErr); retryable && !permanent {
				return admissionErr
			}
			if err := deleteStagedEvidenceCandidate(
				ctx,
				statements,
				evidenceID,
				stored.digestVersion,
				stored.digest,
			); err != nil {
				return err
			}
			removed++
		}
	}
	if removed > 0 {
		if err := recordEvidenceIngestHealth(
			ctx,
			statements,
			evidenceStagingUnpromotableCode,
			removed,
			s.evidenceNow(),
		); err != nil {
			return err
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit evidence candidate cleanup: %w", err)
	}
	committed = true
	return nil
}

func evidenceIDsFromValidEdges(batch Batch) []string {
	ids := make([]string, 0)
	for _, record := range batch.Records {
		if record.Type != RecordEdge || ValidateRecord(record) != nil {
			continue
		}
		var edge EdgeRecord
		if json.Unmarshal(record.Payload, &edge) != nil ||
			edge.EdgeType != "evidence.for" {
			continue
		}
		var attributes evidenceEdgeAttributes
		if json.Unmarshal(edge.Attributes, &attributes) == nil {
			ids = append(ids, attributes.EvidenceID)
		}
	}
	return uniqueStrings(ids)
}

func validateEvidenceCandidatePromotionAdmission(
	ctx context.Context,
	statements *ingestStatements,
	record Record,
	artifact ArtifactRecord,
) error {
	if err := validateEvidenceRecordAdmission(ctx, statements, record); err != nil {
		return err
	}
	stored, err := loadStoredArtifact(ctx, statements, artifact.ArtifactID)
	if err != nil || stored == nil {
		return err
	}
	matches, err := sameStoredArtifact(*stored, artifact)
	if err != nil {
		return err
	}
	if !matches {
		return evidenceConflict()
	}
	return nil
}

func deleteStagedEvidenceCandidate(
	ctx context.Context,
	statements *ingestStatements,
	evidenceID string,
	digestVersion int,
	digest string,
) error {
	if _, err := statements.exec(ctx, `
		DELETE FROM evidence_staging_candidates
		WHERE authorization_namespace = ? AND evidence_id = ?
		  AND digest_version = ? AND candidate_digest = ?
	`, localEvidenceAuthorizationNamespace, evidenceID, digestVersion,
		digest); err != nil {
		return fmt.Errorf("delete unpromotable evidence candidate: %w", err)
	}
	return nil
}
