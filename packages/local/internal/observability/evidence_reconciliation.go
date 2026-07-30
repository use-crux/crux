package observability

import (
	"context"
	"database/sql"
	"fmt"
)

func (s *Service) reconcileDirectEvidenceArtifact(
	ctx context.Context,
	statements *ingestStatements,
	record Record,
	artifact ArtifactRecord,
	marker evidenceSourceArtifactMarker,
	material evidenceCandidateMaterial,
	reservation storedEvidenceReservation,
) error {
	matches, err := candidateMatchesReservation(
		ctx,
		statements,
		artifact,
		marker,
		material.Candidate,
		reservation,
	)
	if err != nil {
		return err
	}
	if !matches {
		return evidenceConflict()
	}
	compacted, err := reconcileExpiredEvidencePayloadRetry(
		ctx,
		statements,
		marker.EvidenceID,
		record,
	)
	if err != nil {
		return err
	}
	if compacted {
		return deleteEvidenceCandidateSiblings(
			ctx,
			statements,
			marker.EvidenceID,
		)
	}
	if err := s.materializeEvidenceArtifact(
		ctx,
		statements,
		record,
		artifact,
	); err != nil {
		return err
	}
	if err := persistEvidencePayloadRecordDigest(
		ctx,
		statements,
		marker.EvidenceID,
		record,
	); err != nil {
		return err
	}
	changed, err := s.hydrateEvidenceRelationship(
		ctx,
		statements,
		marker.EvidenceID,
		material.Candidate,
	)
	if err != nil {
		return err
	}
	if changed {
		if err := bumpEvidenceSubjectRevision(
			ctx,
			statements,
			reservation.subjectKind,
			reservation.subjectID,
		); err != nil {
			return err
		}
	}
	return deleteEvidenceCandidateSiblings(
		ctx,
		statements,
		marker.EvidenceID,
	)
}

func candidateMatchesReservation(
	ctx context.Context,
	statements *ingestStatements,
	artifact ArtifactRecord,
	marker evidenceSourceArtifactMarker,
	candidate evidenceCandidateV1,
	reservation storedEvidenceReservation,
) (bool, error) {
	var conclusion, observedAt, captureState sql.NullString
	err := statements.queryRow(ctx, `
		SELECT conclusion, observed_at, original_capture_state
		FROM evidence_relationships
		WHERE authorization_namespace = ? AND evidence_id = ?
	`, localEvidenceAuthorizationNamespace, marker.EvidenceID).Scan(
		&conclusion,
		&observedAt,
		&captureState,
	)
	if err != nil {
		return false, fmt.Errorf("load evidence relationship identity: %w", err)
	}
	if reservation.sourceMode.String != "inline" ||
		reservation.sourceKind != "artifact" ||
		reservation.sourceID != artifact.ArtifactID ||
		reservation.evidenceKind != artifact.Kind ||
		!captureState.Valid ||
		captureState.String != marker.CaptureState {
		return false, nil
	}
	if !reservation.contentDigest.Valid {
		return true, nil
	}
	supersedes, err := loadEvidenceSupersessionIDs(
		ctx,
		statements,
		marker.EvidenceID,
	)
	if err != nil {
		return false, err
	}
	digest, err := evidenceDigestForCandidate(
		NodeRef{Kind: reservation.subjectKind, ID: reservation.subjectID},
		reservation.role,
		reservation.evidenceKind,
		conclusion.String,
		observedAt.String,
		supersedes,
		candidate,
	)
	return digest == reservation.contentDigest.String, err
}

func candidateMatchesEdge(
	edge EdgeRecord,
	attributes evidenceEdgeAttributes,
	artifact ArtifactRecord,
	marker evidenceSourceArtifactMarker,
	candidate evidenceCandidateV1,
) (bool, error) {
	if *attributes.SourceMode != "inline" ||
		edge.From.Kind != "artifact" ||
		edge.From.ID != artifact.ArtifactID ||
		attributes.EvidenceID != marker.EvidenceID ||
		attributes.EvidenceKind != artifact.Kind ||
		attributes.CaptureState == nil ||
		*attributes.CaptureState != marker.CaptureState {
		return false, nil
	}
	if attributes.ContentDigest == nil {
		return true, nil
	}
	digest, err := evidenceDigestForCandidate(
		edge.To,
		attributes.Role,
		attributes.EvidenceKind,
		dereferenceString(attributes.Conclusion),
		dereferenceString(attributes.ObservedAt),
		attributes.SupersedesEvidenceIDs,
		candidate,
	)
	return digest == *attributes.ContentDigest, err
}

func evidenceDigestForCandidate(
	subject NodeRef,
	role string,
	evidenceKind string,
	conclusion string,
	observedAt string,
	supersedes []string,
	candidate evidenceCandidateV1,
) (string, error) {
	source, err := evidenceInlineDigestSource(
		candidate.CaptureState,
		candidate.Preview,
		candidate.Hash,
		candidate.SizeBytes,
	)
	if err != nil {
		return "", err
	}
	return evidenceContentDigestV1(evidenceContentDigestInputV1{
		Subject:               subject,
		Role:                  role,
		EvidenceKind:          evidenceKind,
		SourceMode:            "inline",
		Conclusion:            conclusion,
		ObservedAt:            observedAt,
		SupersedesEvidenceIDs: supersedes,
		Source:                source,
	})
}

func loadEvidenceSupersessionIDs(
	ctx context.Context,
	statements *ingestStatements,
	evidenceID string,
) ([]string, error) {
	rows, err := statements.tx.QueryContext(ctx, `
		SELECT superseded_evidence_id
		FROM evidence_supersessions
		WHERE authorization_namespace = ? AND evidence_id = ?
	`, localEvidenceAuthorizationNamespace, evidenceID)
	if err != nil {
		return nil, fmt.Errorf("load evidence supersessions: %w", err)
	}
	defer rows.Close()
	result := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		result = append(result, id)
	}
	return result, rows.Err()
}

func (s *Service) hydrateEvidenceRelationship(
	ctx context.Context,
	statements *ingestStatements,
	evidenceID string,
	candidate evidenceCandidateV1,
) (bool, error) {
	var existingState, verificationState string
	var existingPayload sql.NullString
	if err := statements.queryRow(ctx, `
		SELECT relationships.payload_state, relationships.payload_json,
			reservations.digest_verification_state
		FROM evidence_relationships relationships
		JOIN evidence_reservations reservations
		  USING (authorization_namespace, evidence_id)
		WHERE relationships.authorization_namespace = ?
		  AND relationships.evidence_id = ?
	`, localEvidenceAuthorizationNamespace, evidenceID).Scan(
		&existingState,
		&existingPayload,
		&verificationState,
	); err != nil {
		return false, fmt.Errorf("load evidence hydration state: %w", err)
	}
	payloadState := candidate.CaptureState
	var payload any
	var acceptedAt any
	if candidate.CaptureState == "available" {
		payload = string(candidate.Preview)
		acceptedAt = formatEvidenceAcceptanceTime(s.evidenceNow())
	}
	alreadyHydrated := existingState == payloadState &&
		verificationState != "pending" &&
		(candidate.CaptureState != "available" || existingPayload.Valid)
	if alreadyHydrated {
		return false, nil
	}
	if _, err := statements.exec(ctx, `
		UPDATE evidence_relationships
		SET payload_state = ?, payload_json = ?,
			payload_unavailable_reason = NULL,
			payload_accepted_at = coalesce(payload_accepted_at, ?)
		WHERE authorization_namespace = ? AND evidence_id = ?
	`, payloadState, payload, acceptedAt, localEvidenceAuthorizationNamespace,
		evidenceID); err != nil {
		return false, fmt.Errorf("hydrate evidence relationship: %w", err)
	}
	if _, err := statements.exec(ctx, `
		UPDATE evidence_reservations
		SET digest_verification_state = CASE
			WHEN content_digest IS NULL THEN 'not-required'
			ELSE 'verified'
		END
		WHERE authorization_namespace = ? AND evidence_id = ?
	`, localEvidenceAuthorizationNamespace, evidenceID); err != nil {
		return false, fmt.Errorf("verify evidence relationship digest: %w", err)
	}
	return true, nil
}

func deleteEvidenceCandidateSiblings(
	ctx context.Context,
	statements *ingestStatements,
	evidenceID string,
) error {
	if _, err := statements.exec(ctx, `
		DELETE FROM evidence_staging_candidates
		WHERE authorization_namespace = ? AND evidence_id = ?
	`, localEvidenceAuthorizationNamespace, evidenceID); err != nil {
		return fmt.Errorf("delete evidence candidate siblings: %w", err)
	}
	return nil
}
