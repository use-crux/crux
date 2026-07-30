package observability

import (
	"context"
	"encoding/json"
	"fmt"
)

const (
	localEvidenceAuthorizationNamespace  = "local"
	evidenceCanonicalRecordDigestVersion = 1
	evidenceIdempotencyConflictCode      = "EVIDENCE_IDEMPOTENCY_CONFLICT"
)

type evidenceDispositionError struct {
	code      string
	retryable bool
}

func (e *evidenceDispositionError) Error() string {
	return e.code + ": destination rejected evidence delivery"
}

// reserveEvidenceRelationship atomically establishes first-write-wins state
// before the generic edge/raw-record projections run in the same transaction.
// False means an idempotent no-op; caller must not persist the retry record.
func (s *Service) reserveEvidenceRelationship(
	ctx context.Context,
	statements *ingestStatements,
	record Record,
	edge EdgeRecord,
) (bool, error) {
	var attributes evidenceEdgeAttributes
	if err := json.Unmarshal(edge.Attributes, &attributes); err != nil {
		return false, fmt.Errorf("decode evidence relationship: %w", err)
	}
	sourceMode := resolvedEvidenceSourceMode(attributes)
	canonicalRecordDigest, err := evidenceCanonicalRecordDigest(record)
	if err != nil {
		return false, err
	}
	recomputed, complete, err := recomputeEvidenceContentDigest(
		ctx,
		statements,
		edge,
		attributes,
		sourceMode,
	)
	if err != nil {
		return false, err
	}
	if complete && attributes.ContentDigest != nil &&
		recomputed != *attributes.ContentDigest {
		return false, evidenceConflict()
	}

	existing, err := loadEvidenceReservation(
		ctx,
		statements,
		attributes.EvidenceID,
	)
	if err != nil {
		return false, err
	}
	if existing != nil {
		if sameEvidenceReservation(
			*existing,
			edge,
			attributes,
			sourceMode,
			canonicalRecordDigest,
		) {
			return false, nil
		}
		return false, evidenceConflict()
	}
	verificationState := evidenceDigestVerificationState(attributes, complete)
	terminalKind, terminalID, err := acceptedAfterTerminalEvidenceSubject(
		ctx,
		statements,
		edge.To,
	)
	if err != nil {
		return false, err
	}

	acceptedAt := formatEvidenceAcceptanceTime(s.evidenceNow())
	if _, err := statements.exec(ctx, `
		INSERT INTO evidence_reservations (
			authorization_namespace, evidence_id, subject_kind, subject_id,
			role, evidence_kind, source_mode, source_kind, source_id,
			content_digest_version, content_digest, idempotency_key_hash,
			digest_verification_state,
			canonical_record_digest_version, canonical_record_digest,
			edge_id, edge_record_id, relationship_accepted_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		localEvidenceAuthorizationNamespace,
		attributes.EvidenceID,
		edge.To.Kind,
		edge.To.ID,
		attributes.Role,
		attributes.EvidenceKind,
		nullIfEmpty(sourceMode),
		edge.From.Kind,
		edge.From.ID,
		nullInt(attributes.ContentDigestVersion),
		nullString(attributes.ContentDigest),
		nullString(attributes.IdempotencyKeyHash),
		verificationState,
		evidenceCanonicalRecordDigestVersion,
		canonicalRecordDigest,
		edge.EdgeID,
		record.RecordID,
		acceptedAt,
	); err != nil {
		return false, fmt.Errorf("reserve evidence relationship: %w", err)
	}
	payloadState, unavailableReason := initialEvidencePayloadState(attributes)
	superseded, err := evidenceRelationshipIsAlreadySuperseded(
		ctx,
		statements,
		attributes.EvidenceID,
		edge.To,
		attributes.Role,
	)
	if err != nil {
		return false, err
	}
	if _, err := statements.exec(ctx, `
		INSERT INTO evidence_relationships (
			authorization_namespace, evidence_id, subject_kind, subject_id,
			role, evidence_kind, conclusion, observed_at, recorded_at,
			source_mode, source_kind, source_id, producer_kind, producer_id,
			original_capture_state, payload_state, payload_unavailable_reason,
			accepted_after_terminal_kind, accepted_after_terminal_id,
			run_id, edge_id, edge_record_id, relationship_accepted_at,
			superseded
		) VALUES (
			?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
			?
		)
	`,
		localEvidenceAuthorizationNamespace,
		attributes.EvidenceID,
		edge.To.Kind,
		edge.To.ID,
		attributes.Role,
		attributes.EvidenceKind,
		nullString(attributes.Conclusion),
		nullString(attributes.ObservedAt),
		attributes.RecordedAt,
		sourceMode,
		edge.From.Kind,
		edge.From.ID,
		attributes.Producer.Kind,
		attributes.Producer.ID,
		nullString(attributes.CaptureState),
		payloadState,
		nullIfEmpty(unavailableReason),
		nullIfInvalid(terminalKind),
		nullIfInvalid(terminalID),
		record.RunID,
		edge.EdgeID,
		record.RecordID,
		acceptedAt,
		superseded,
	); err != nil {
		return false, fmt.Errorf("materialize evidence relationship: %w", err)
	}
	for _, supersededID := range attributes.SupersedesEvidenceIDs {
		if _, err := statements.exec(ctx, `
			INSERT INTO evidence_supersessions (
				authorization_namespace, evidence_id, superseded_evidence_id
			) VALUES (?, ?, ?)
			ON CONFLICT DO NOTHING
		`, localEvidenceAuthorizationNamespace, attributes.EvidenceID, supersededID); err != nil {
			return false, fmt.Errorf("materialize evidence supersession: %w", err)
		}
		if err := markEvidencePredecessorSuperseded(
			ctx,
			statements,
			attributes.EvidenceID,
			supersededID,
			edge.To,
			attributes.Role,
		); err != nil {
			return false, err
		}
	}
	if sourceMode == "inline" {
		if err := s.promoteStagedEvidenceCandidate(
			ctx,
			statements,
			edge,
			attributes,
		); err != nil {
			return false, err
		}
	}
	if err := bumpEvidenceSubjectRevision(
		ctx,
		statements,
		edge.To.Kind,
		edge.To.ID,
	); err != nil {
		return false, err
	}
	return true, nil
}
